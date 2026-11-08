import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["NVIDIA_API_KEY"] = ""  # tests always use the deterministic engine

import pytest  # noqa: E402

from app import create_app  # noqa: E402
from app.config import Config  # noqa: E402


@pytest.fixture(scope="session")
def client():
    Config.NVIDIA_API_KEY = ""
    app = create_app(seed=True, force_memory=True)
    return app.test_client()
