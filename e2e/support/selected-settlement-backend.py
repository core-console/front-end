"""Serve the T07 candidate using only the backend's guarded dedicated test target.

Run from the backend root with its pinned uv runtime. No application database is used.
"""

import asyncio
import importlib.util
from pathlib import Path
from uuid import UUID

import uvicorn
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core_console.app import create_app
from core_console.config import AuthMode, Environment, Settings
from core_console.modules.finance.models import FinanceAccountMovement
from core_console.modules.finance.settlement_models import (
    FinanceCreditOrigin,
    FinanceSettlement,
    FinanceSettlementAllocation,
    FinanceSettlementIncome,
)
from core_console.modules.users.models import User

ACTOR = UUID("edb4ee80-17c6-46b5-863e-2afa18e84043")


async def main() -> None:
    spec = importlib.util.spec_from_file_location(
        "protected_database", Path.cwd() / "tests/integration/conftest.py"
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Run from the backend repository with its protected fixtures.")
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
                identity_subject="t07-browser",
                status="active",
            )
        )
        await session.commit()
    app = create_app(
        Settings(
            environment=Environment.TEST,
            auth_mode=AuthMode.DEVELOPMENT,
            dev_identity_issuer="https://identity.example.test",
            dev_identity_subject="t07-browser",
            database_url=SecretStr(database_url),
        )
    )

    @app.get("/t07-test/effects/{ledger_id}")
    async def effects(ledger_id: UUID) -> dict[str, object]:
        # Test-only independent committed-effect observation for browser response-loss proof.
        async with sessions() as session:
            counts = {
                model.__tablename__: await session.scalar(
                    select(func.count()).select_from(model).where(model.ledger_id == ledger_id)
                )
                for model in (
                    FinanceSettlement,
                    FinanceSettlementAllocation,
                    FinanceCreditOrigin,
                    FinanceSettlementIncome,
                )
            }
            scopes = (
                await session.scalars(
                    select(FinanceSettlement.selected_obligation_ids).where(
                        FinanceSettlement.ledger_id == ledger_id
                    )
                )
            ).all()
            movement_total = await session.scalar(
                select(func.sum(FinanceAccountMovement.amount)).where(
                    FinanceAccountMovement.ledger_id == ledger_id
                )
            )
            return {
                "counts": counts,
                "scopes": [[str(id) for id in scope] for scope in scopes],
                "movementTotal": str(movement_total),
            }

    try:
        await uvicorn.Server(
            uvicorn.Config(app, host="127.0.0.1", port=8297, access_log=False)
        ).serve()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main(), loop_factory=asyncio.SelectorEventLoop)
