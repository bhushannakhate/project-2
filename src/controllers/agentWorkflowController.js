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
import { invokeAdkWorkflow } from "../services/adkAgentService.js";

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

export async function postAgentWorkflow(request, response, config) {
  const requestId = randomUUID();
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
  const instructions = request.agentInstructions;
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
    };
    await updateCreation(firestore, userId, creationId, {
      status: "completed",
      revisionCount: output.revisionCount,
      instructions,
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
    response.json({ creation: updatedCreation, workflowId, requestId, media });
  } catch (error) {
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
