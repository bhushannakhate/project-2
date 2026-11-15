import os

from google.adk.agents import Agent, SequentialAgent

from .tools.gemini_tools import (
    analyze_source_photo,
    generate_edited_image,
    prepare_publication,
    review_and_revise_once,
)
from .tools.media_tools import transcribe_user_audio

MODEL = os.getenv("GEMINI_TEXT_MODEL", "gemini-3.5-flash")

audio_processing_agent = Agent(
    name="audio_processing_agent",
    model=MODEL,
    description="Transcribes and summarizes the audio recording uploaded for this creation.",
    instruction=(
        "Process only the user-uploaded audio provided by the trusted workflow context. "
        "Call transcribe_user_audio once. Capture the user's spoken editing instructions "
        "and a concise summary. Do not invent speech or use sample audio."
    ),
    tools=[transcribe_user_audio],
    output_key="audio_agent_summary",
)

creative_coordinator = Agent(
    name="creative_coordinator",
    model=MODEL,
    description="Combines typed and transcribed instructions into a focused image-edit brief.",
    instruction=(
        "Create a concise, faithful visual-editing brief. Combine the user's typed "
        "instructions ({instructions?}) with the uploaded-audio transcript "
        "({audio_transcript?}). Preserve the user's intent, do not add unsupported "
        "details, and do not claim to have generated or saved an image."
    ),
    output_key="creative_brief",
)

image_retrieval_agent = Agent(
    name="image_retrieval_agent",
    model=MODEL,
    description=(
        "Analyzes the creation's already-imported source photo and generates an edited "
        "image that follows the creative brief."
    ),
    instruction=(
        "Use only the source image URL in this trusted workflow context; it was imported "
        "and validated by the Express backend. First call analyze_source_photo, then "
        "call generate_edited_image once. Use the creative brief ({creative_brief?}), "
        "audio transcript ({audio_transcript?}), and source-photo analysis. Do not "
        "request Google Photos access or another user's media."
    ),
    tools=[analyze_source_photo, generate_edited_image],
    output_key="image_agent_summary",
)

review_agent = Agent(
    name="review_agent",
    model=MODEL,
    description=(
        "Checks the generated image against the source photo and user instructions, "
        "and allows at most one automated revision."
    ),
    instruction=(
        "Review the generated image for alignment with the user's typed and spoken "
        "instructions and the source photo. Call review_and_revise_once exactly once. "
        "The tool performs the review and, only if needed, one automated revision "
        "followed by a final review. Never claim approval if the tool rejects it."
    ),
    tools=[review_and_revise_once],
    output_key="review_agent_summary",
)

publishing_agent = Agent(
    name="publishing_agent",
    model=MODEL,
    description=(
        "Prepares an approved image and concise metadata for Express to save through "
        "the existing authorized Cloud Storage and Firestore workflow."
    ),
    instruction=(
        "If and only if the automated review approved the image, write a concise "
        "caption and call prepare_publication. The Express backend, not this agent, "
        "performs the authorized media upload and Firestore update. Do not claim "
        "durable publication until the backend confirms it."
    ),
    tools=[prepare_publication],
    output_key="publishing_agent_summary",
)

root_agent = SequentialAgent(
    name="pinboard_creation_workflow",
    description="Coordinates uploaded-audio processing, photo analysis, editing, review, and publication.",
    sub_agents=[
        audio_processing_agent,
        creative_coordinator,
        image_retrieval_agent,
        review_agent,
        publishing_agent,
    ],
)
