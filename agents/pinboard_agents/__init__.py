from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"), override=False)

from .agent import root_agent

__all__ = ["root_agent"]