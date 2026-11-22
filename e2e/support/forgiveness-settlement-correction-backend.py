"""Run from the backend root with its venv and guarded TEST_DATABASE_URL."""

import asyncio
import sys
from pathlib import Path

import uvicorn
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from core_console.app import create_app
from core_console.config import AuthMode, Environment, Settings
from core_console.modules.users.models import User

sys.path[:0] = [str(Path.cwd()), str(Path.cwd() / "tests")]
from integration.conftest import _validated_test_database_url
from scripts.test_postgres import prepare_postgres


async def serve(url: str) -> None:
    issuer, subject = "https://identity.example.test", "t15b-browser"
    engine = create_async_engine(url)
    async with AsyncSession(engine) as session:
        session.add(User(identity_issuer=issuer, identity_subject=subject, status="active"))
        await session.commit()
    await engine.dispose()
    app = create_app(
        Settings(
            environment=Environment.TEST,
            auth_mode=AuthMode.DEVELOPMENT,
            dev_identity_issuer=issuer,
            dev_identity_subject=subject,
            database_url=SecretStr(url),
        )
    )
    await uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=8301, access_log=False)
    ).serve()


if __name__ == "__main__":
    url = _validated_test_database_url()
    with prepare_postgres(url, Path("alembic.ini"), record=lambda _: None, observe_sql=lambda: None):
        asyncio.run(serve(url), loop_factory=asyncio.SelectorEventLoop)
