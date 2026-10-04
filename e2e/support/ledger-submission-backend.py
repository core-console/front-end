"""Serve the exact T02 producer against its guarded dedicated test database.

Run from the backend cwd with its pinned uv runtime. This is test infrastructure;
the producer checkout stays unchanged. The backend's existing protected fixture
resets/migrates TEST_DATABASE_URL, never DATABASE_URL.
"""

import asyncio
import importlib.util
import subprocess
from pathlib import Path
from uuid import UUID

import uvicorn
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core_console.app import create_app
from core_console.config import AuthMode, Environment, Settings
from core_console.modules.finance.models import FinanceLedger
from core_console.modules.finance.submission_models import FinanceSubmission
from core_console.modules.users.models import User

PRODUCER = "64667936120d47c6c7635812628f5c4667834ade"
ACTOR = UUID("edb4ee80-17c6-46b5-863e-2afa18e84043")


async def main() -> None:
    root = Path.cwd()
    revision = (
        await asyncio.to_thread(subprocess.check_output, ["git", "rev-parse", "HEAD"], text=True)
    ).strip()
    if revision != PRODUCER:
        raise RuntimeError("The integrated test requires the pinned T02 producer.")
    spec = importlib.util.spec_from_file_location(
        "protected_database", root / "tests/integration/conftest.py"
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Protected database fixture is unavailable.")
    protected = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(protected)
    database_url = protected._validated_test_database_url()
    await protected._reset_and_upgrade(database_url)
    engine = create_async_engine(database_url)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add(
            User(
                id=ACTOR,
                identity_issuer="https://identity.example.test",
                identity_subject="t03-browser",
                username="operator",
                display_name="Core Console Operator",
                email="operator@example.com",
                status="active",
            )
        )
        await session.commit()
    app = create_app(
        Settings(
            environment=Environment.TEST,
            auth_mode=AuthMode.DEVELOPMENT,
            dev_identity_issuer="https://identity.example.test",
            dev_identity_subject="t03-browser",
            database_url=SecretStr(database_url),
        )
    )

    # This diagnostic exists only on this isolated test app; it is never a
    # production endpoint, and exposes counts without connection credentials.
    @app.get("/t03-test/effects")
    async def effects() -> dict[str, int]:
        async with sessions() as session:
            return {
                "ledgers": await session.scalar(select(func.count()).select_from(FinanceLedger))
                or 0,
                "submissions": await session.scalar(
                    select(func.count()).select_from(FinanceSubmission)
                )
                or 0,
            }

    try:
        await uvicorn.Server(
            uvicorn.Config(app, host="127.0.0.1", port=8290, access_log=False)
        ).serve()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main(), loop_factory=asyncio.SelectorEventLoop)
