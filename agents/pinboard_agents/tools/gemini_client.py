from contextlib import asynccontextmanager
import os
from collections.abc import AsyncIterator
from typing import Any

from google import genai


@asynccontextmanager
async def gemini_async_client() -> AsyncIterator[Any]:
    client = genai.Client(
        vertexai=True,
        project=os.environ["GOOGLE_CLOUD_PROJECT"],
        location=os.getenv("GOOGLE_CLOUD_LOCATION", "global"),
    )
    async_client = client.aio
    try:
        yield async_client
    finally:
        await async_client.aclose()
        client.close()
