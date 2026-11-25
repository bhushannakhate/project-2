import { randomUUID } from "node:crypto";
import {
  completeMediaUpload,
  createMediaDownloadUrl,
  stageMediaUploadBuffer,
} from "../services/mediaStorageService.js";
import { getCreation, updateCreation } from "../services/firestoreService.js";
import { getFirebase } from "../config/firebase.js";
import { ApiError } from "../middleware/errorHandler.js";
import { normalizeImageBuffer } from "../models/imageValidation.js";
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES } from "../models/mediaValidation.js";
import {
  invokeAdkTranscription,
  invokeAdkWorkflow,
} from "../services/adkAgentService.js";
import { sendAnalyticsEvent } from "../services/analyticsService.js";

const AUDIO_CONTENT_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);
const MAX_SUMMARY_LENGTH = 700;
const MAX_CAPTION_LENGTH = 1000;
const AGENT_MEDIA_URL_TTL_MS = 15 * 60 * 1000;
const MAX_TRANSCRIPT_LENGTH = 4000;

function assertMediaReference(reference, userId, creationId, mediaKind) {
  const prefix = `users/${userId}/creations/${creationId}/${mediaKind}/`;
  const objectName = reference?.objectPath?.startsWith(prefix)
    ? reference.objectPath.slice(prefix.length)
    : "";
  if (
    !/^[\da-f-]{36}$/i.test(objectName) ||
    (mediaKind === "sourceImage" &&
      !["image/jpeg", "image/png", "image/webp"].includes(
        reference.contentType,
      )) ||
    (mediaKind === "audio" &&
      !AUDIO_CONTENT_TYPES.has(reference.contentType)) ||
    !Number.isSafeInteger(reference.sizeBytes) ||
    reference.sizeBytes < 1 ||
    reference.sizeBytes >
      (mediaKind === "audio" ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES)
  ) {
    throw new ApiError(
      409,
      "MEDIA_REQUIRED",
      `A valid uploaded ${mediaKind === "audio" ? "audio recording" : "source image"} is required.`,
    );
  }
}

function summarizeAgentResult(result) {
  if (
    !result ||
    typeof result !== "object" ||
    typeof result.approved !== "boolean"
  ) {
    throw new ApiError(
      502,
      "AGENT_UNAVAILABLE",
      "The agent service returned an invalid workflow result.",
    );
  }
  if (!result.approved) {
    throw new ApiError(
      422,
      "REVIEW_REJECTED",
      "The generated image did not pass the automated review.",
    );
  }
  if (
    !Number.isInteger(result.revision_count) ||
    result.revision_count < 0 ||
    result.revision_count > 1 ||
    typeof result.image_base64 !== "string" ||
    !["image/jpeg", "image/png", "image/webp"].includes(
      result.image_content_type,
    )
  ) {
    throw new ApiError(
      502,
      "AGENT_UNAVAILABLE",
      "The agent service returned an invalid workflow result.",
    );
  }

  const imageBuffer = Buffer.from(result.image_base64, "base64");
  if (
    imageBuffer.length === 0 ||
    imageBuffer.length > MAX_IMAGE_BYTES ||
    imageBuffer.toString("base64") !== result.image_base64
  ) {
    throw new ApiError(
      502,
      "AGENT_UNAVAILABLE",
      "The agent service returned invalid image data.",
    );
  }

  const audioConfidence =
    result.audio_confidence === null || result.audio_confidence === undefined
      ? null
      : Number(result.audio_confidence);
  if (
    audioConfidence !== null &&
    (!Number.isFinite(audioConfidence) ||
      audioConfidence < 0 ||
      audioConfidence > 1)
  ) {
    throw new ApiError(
      502,
      "AGENT_UNAVAILABLE",
      "The agent service returned invalid transcription confidence.",
    );
  }

  return {
    imageBuffer,
    imageContentType: result.image_content_type,
    revisionCount: result.revision_count,
    caption:
      typeof result.caption === "string"
        ? result.caption.slice(0, MAX_CAPTION_LENGTH)
        : "",
    audioSummary:
      typeof result.audio_summary === "string"
        ? result.audio_summary.slice(0, MAX_SUMMARY_LENGTH)
        : "",
    imageAnalysis:
      typeof result.image_analysis === "string"
        ? result.image_analysis.slice(0, MAX_SUMMARY_LENGTH)
        : "",
    creativeBrief:
      typeof result.creative_brief === "string"
        ? result.creative_brief.slice(0, MAX_SUMMARY_LENGTH)
        : "",
    audioTranscript:
      typeof result.audio_transcript === "string"
        ? result.audio_transcript.slice(0, MAX_TRANSCRIPT_LENGTH)
        : "",
    audioConfidence,
  };
}

async function saveOutputMedia(firestore, bucket, userId, creationId, output) {
  const normalized = await normalizeImageBuffer(
    output.imageBuffer,
    output.imageContentType,
  );
  const upload = await stageMediaUploadBuffer(
    firestore,
    bucket,
    userId,
    creationId,
    "outputImage",
    normalized.contentType,
    normalized.buffer,
  );
  const media = await completeMediaUpload(
    firestore,
    bucket,
    userId,
    creationId,
    upload.uploadId,
  );
  if (!media) {
    throw new ApiError(
      409,
      "CREATION_CHANGED",
      "The creation changed while the generated image was being saved.",
    );
  }
  return media;
}

async function archivePreviousOutputMedia(bucket, userId, creationId, media) {
  const expectedPrefix = `users/${userId}/creations/${creationId}/outputImage/`;
  if (!media?.objectPath?.startsWith(expectedPrefix)) return null;
  const archivePath = `users/${userId}/creations/${creationId}/outputHistory/${randomUUID()}`;
  await bucket.file(media.objectPath).copy(bucket.file(archivePath));
  return {
    ...media,
    objectPath: archivePath,
    archivedAt: new Date().toISOString(),
  };
}

export async function postAgentWorkflow(request, response, config) {
  const requestId = randomUUID();
  const workflowStartedAt = Date.now();
  const analyticsContext = {
    clientId: request.get("x-ga-client-id"),
    sessionId: request.get("x-ga-session-id"),
  };
  response.setHeader("X-Request-Id", requestId);
  const userId = request.firebaseUser.uid;
  const { creationId } = request.params;
  const { firestore, bucket } = getFirebase(config);
  const creation = await getCreation(firestore, userId, creationId);
  if (!creation) {
    throw new ApiError(404, "NOT_FOUND", "Creation not found.");
  }

  const sourceImage = creation.media?.sourceImage;
  assertMediaReference(sourceImage, userId, creationId, "sourceImage");
  const includeAudio =
    request.agentIncludeAudio ?? Boolean(creation.media?.audio);
  const audio = includeAudio ? creation.media?.audio : null;
  if (audio) {
    assertMediaReference(audio, userId, creationId, "audio");
  } else if (includeAudio) {
    throw new ApiError(
      409,
      "MEDIA_REQUIRED",
      "The selected audio recording is unavailable. Re-upload it or run with written instructions only.",
    );
  }
  const isUserRevision = creation.reviewStatus === "revision_requested";
  if (
    creation.reviewStatus === "approved" ||
    creation.reviewStatus === "revised"
  ) {
    throw new ApiError(
      409,
      "REVIEW_COMPLETE",
      "This creation has already completed its review workflow.",
    );
  }
  if (isUserRevision && creation.reviewRevisionCount !== 0) {
    throw new ApiError(
      409,
      "REVISION_LIMIT_REACHED",
      "Only one revision can be generated for a creation.",
    );
  }
  const instructions = isUserRevision
    ? `${creation.instructions || ""}\n\nRevision request: ${request.agentInstructions}`.trim()
    : request.agentInstructions;
  if (!instructions && !audio) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "Enter written instructions or add an audio recording.",
    );
  }

  const sourceImageDownload = await createMediaDownloadUrl(
    bucket,
    userId,
    creationId,
    "sourceImage",
    creation,
    AGENT_MEDIA_URL_TTL_MS,
  );
  const audioDownload = audio
    ? await createMediaDownloadUrl(
        bucket,
        userId,
        creationId,
        "audio",
        creation,
        AGENT_MEDIA_URL_TTL_MS,
      )
    : null;
  if (!sourceImageDownload || (audio && !audioDownload)) {
    throw new ApiError(
      409,
      "MEDIA_REQUIRED",
      "The uploaded source image or audio recording is unavailable.",
    );
  }
  const workflowId = randomUUID();
  await updateCreation(firestore, userId, creationId, { status: "processing" });

  try {
    const responsePayload = await invokeAdkWorkflow(config, {
      request_id: requestId,
      user_id: userId,
      creation_id: creationId,
      workflow_id: workflowId,
      instructions,
      ...(request.agentTranscript
        ? { audio_transcript: request.agentTranscript }
        : {}),
      source_image_url: sourceImageDownload.downloadUrl,
      source_image_content_type: sourceImage.contentType,
      ...(audio && audioDownload
        ? {
            audio_url: audioDownload.downloadUrl,
            audio_content_type: audio.contentType,
          }
        : {}),
    });
    const output = summarizeAgentResult(responsePayload);
    const archivedOutput = isUserRevision
      ? await archivePreviousOutputMedia(
          bucket,
          userId,
          creationId,
          creation.media?.outputImage,
        )
      : null;
    const media = await saveOutputMedia(
      firestore,
      bucket,
      userId,
      creationId,
      output,
    );

    const agentMetadata = {
      workflowId,
      revisionCount: output.revisionCount,
      caption: output.caption,
      audioSummary: output.audioSummary,
      imageAnalysis: output.imageAnalysis,
      creativeBrief: output.creativeBrief,
      audioTranscript: output.audioTranscript,
      audioConfidence: output.audioConfidence,
      geminiConsentAt: new Date().toISOString(),
      reviewStatus: isUserRevision ? "revised" : "pending",
    };
    const reviewHistory = isUserRevision
      ? [
          ...(creation.reviewHistory || []),
          {
            output: archivedOutput,
            revisionInstruction: request.agentInstructions,
            archivedAt: new Date().toISOString(),
          },
        ]
      : [];
    await updateCreation(firestore, userId, creationId, {
      status: "completed",
      revisionCount: output.revisionCount,
      reviewStatus: isUserRevision ? "revised" : "pending",
      reviewRevisionCount: isUserRevision ? 1 : 0,
      review: {
        ...(creation.review || {}),
        status: isUserRevision ? "revised" : "pending",
        ...(isUserRevision
          ? { revisionInstruction: request.agentInstructions }
          : {}),
      },
      reviewHistory,
      instructions: isUserRevision ? creation.instructions : instructions,
      agentWorkflow: agentMetadata,
    });
    const updatedCreation = await getCreation(firestore, userId, creationId);
    console.info(
      JSON.stringify({
        event: "agent_workflow_completed",
        requestId,
        creationId,
        workflowId,
      }),
    );
    await sendAnalyticsEvent(config, analyticsContext, "agent_workflow", {
      workflow_status: "completed",
      duration_ms: Date.now() - workflowStartedAt,
      revision_count: output.revisionCount,
    });
    response.json({ creation: updatedCreation, workflowId, requestId, media });
  } catch (error) {
    await sendAnalyticsEvent(config, analyticsContext, "agent_workflow", {
      workflow_status: "failed",
      duration_ms: Date.now() - workflowStartedAt,
    });
    try {
      await updateCreation(firestore, userId, creationId, {
        status: "failed",
      });
    } catch (statusError) {
      console.error(
        JSON.stringify({
          event: "agent_workflow_status_update_failed",
          requestId,
          errorType: statusError.name,
        }),
      );
      throw new AggregateError(
        [error, statusError],
        "Agent workflow and failure status update both failed.",
        { cause: error },
      );
    }
    console.error(
      JSON.stringify({
        event: "agent_workflow_failed",
        requestId,
        creationId,
        errorType: error.name,
        errorCode: error.code,
      }),
    );
    throw error;
  }
}

function assertAudioReference(reference, userId, creationId) {
  const prefix = `users/${userId}/creations/${creationId}/audio/`;
  if (
    !reference?.objectPath?.startsWith(prefix) ||
    !AUDIO_CONTENT_TYPES.has(reference.contentType) ||
    !Number.isSafeInteger(reference.sizeBytes) ||
    reference.sizeBytes < 1 ||
    reference.sizeBytes > MAX_AUDIO_BYTES
  ) {
    throw new ApiError(
      409,
      "MEDIA_REQUIRED",
      "A valid uploaded audio recording is required.",
    );
  }
}

function normalizeTranscription(result) {
  const text =
    typeof result?.transcription === "string"
      ? result.transcription.trim().slice(0, MAX_TRANSCRIPT_LENGTH)
      : "";
  const confidence =
    result?.confidence === null || result?.confidence === undefined
      ? null
      : Number(result.confidence);
  if (
    !text ||
    (confidence !== null &&
      (!Number.isFinite(confidence) || confidence < 0 || confidence > 1))
  ) {
    throw new ApiError(
      502,
      "TRANSCRIPTION_UNAVAILABLE",
      "The transcription service returned an invalid result.",
    );
  }
  return { text, confidence };
}

export async function postCreationTranscription(request, response, config) {
  const requestId = randomUUID();
  const { firestore, bucket } = getFirebase(config);
  const userId = request.firebaseUser.uid;
  const { creationId } = request.params;
  const creation = await getCreation(firestore, userId, creationId);
  if (!creation) {
    throw new ApiError(404, "NOT_FOUND", "Creation not found.");
  }
  const audio = creation.media?.audio;
  assertAudioReference(audio, userId, creationId);
  const audioDownload = await createMediaDownloadUrl(
    bucket,
    userId,
    creationId,
    "audio",
    creation,
    AGENT_MEDIA_URL_TTL_MS,
  );
  if (!audioDownload) {
    throw new ApiError(
      409,
      "MEDIA_REQUIRED",
      "The audio recording is unavailable.",
    );
  }

  const result = normalizeTranscription(
    await invokeAdkTranscription(config, {
      request_id: requestId,
      user_id: userId,
      creation_id: creationId,
      audio_url: audioDownload.downloadUrl,
      audio_content_type: audio.contentType,
    }),
  );
  await updateCreation(firestore, userId, creationId, {
    audioTranscription: {
      text: result.text,
      confidence: result.confidence,
      provider: "Google Gemini audio transcription",
      edited: false,
      updatedAt: new Date().toISOString(),
    },
  });
  response.json({
    transcription: result,
    requestId,
  });
}

export async function patchCreationTranscription(request, response) {
  const { firestore } = getFirebase();
  const userId = request.firebaseUser.uid;
  const { creationId } = request.params;
  const creation = await getCreation(firestore, userId, creationId);
  if (!creation) {
    throw new ApiError(404, "NOT_FOUND", "Creation not found.");
  }
  const text = request.body.transcript.trim();
  const previous = creation.audioTranscription || {};
  await updateCreation(firestore, userId, creationId, {
    audioTranscription: {
      text,
      confidence: previous.confidence ?? null,
      provider: previous.provider || "Google Gemini audio transcription",
      edited: true,
      updatedAt: new Date().toISOString(),
    },
  });
  response.json({
    transcription: {
      text,
      confidence: previous.confidence ?? null,
      edited: true,
    },
  });
}

function assertReviewableCreation(creation, userId, creationId) {
  const outputPath = creation.media?.outputImage?.objectPath;
  const expectedPrefix = `users/${userId}/creations/${creationId}/outputImage/`;
  if (
    creation.status !== "completed" ||
    !outputPath?.startsWith(expectedPrefix) ||
    !["pending", "revised"].includes(creation.reviewStatus)
  ) {
    throw new ApiError(
      409,
      "REVIEW_UNAVAILABLE",
      "This creation does not have a generated result waiting for review.",
    );
  }
}

export async function postCreationReview(request, response) {
  const { firestore } = getFirebase();
  const userId = request.firebaseUser.uid;
  const { creationId } = request.params;
  const creationReference = firestore
    .collection("users")
    .doc(userId)
    .collection("creations")
    .doc(creationId);
  const now = new Date().toISOString();

  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(creationReference);
    if (!snapshot.exists || snapshot.data().isDeleted) {
      throw new ApiError(404, "NOT_FOUND", "Creation not found.");
    }
    const creation = { id: snapshot.id, ...snapshot.data() };
    assertReviewableCreation(creation, userId, creationId);

    if (request.reviewAction === "request_revision") {
      if (creation.reviewStatus !== "pending") {
        throw new ApiError(
          409,
          "REVISION_LIMIT_REACHED",
          "Only one revision can be requested for a creation.",
        );
      }
      transaction.update(creationReference, {
        reviewStatus: "revision_requested",
        review: {
          ...(creation.review || {}),
          status: "revision_requested",
          revisionInstruction: request.reviewInstruction,
          revisionRequestedAt: now,
        },
        updatedAt: now,
      });
      return;
    }

    const reviewStatus =
      request.reviewAction === "reject" ? "rejected" : "approved";
    transaction.update(creationReference, {
      reviewStatus,
      review: {
        ...(creation.review || {}),
        status: reviewStatus,
        ...(reviewStatus === "rejected"
          ? { rejectedAt: now }
          : { approvedAt: now }),
      },
      updatedAt: now,
    });
  });

  const updatedCreation = await getCreation(firestore, userId, creationId);
  response.json({ creation: updatedCreation });
}
