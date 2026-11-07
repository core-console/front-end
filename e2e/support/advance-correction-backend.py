"""Exact-P T12 browser server using only the producer's guarded test database."""
import asyncio
import importlib.util
import os
import subprocess
from pathlib import Path
from uuid import UUID
import uvicorn
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from core_console.app import create_app
from core_console.config import AuthMode, Environment, Settings
from core_console.modules.users.models import User
from core_console.modules.finance.advance_correction_models import FinanceAdvanceCorrection
from core_console.modules.finance.models import FinanceAccountMovement
from core_console.modules.finance.submission_models import FinanceSubmission

async def main():
    expected_producer = os.environ.get(
        "FINANCE_T12_TEST_PRODUCER", "d87550d839d2b45a9bb8d5c804016e0936e20163"
    )
    producer = subprocess.check_output(
        ["git", "rev-parse", "--verify", "HEAD"], text=True
    ).strip()
    if producer != expected_producer:
        raise RuntimeError("T12 browser server requires the exact configured Producer.")
    subprocess.run(
        ["git", "diff", "--exit-code", "HEAD", "--"],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    spec = importlib.util.spec_from_file_location("protected_database", Path.cwd() / "tests/integration/conftest.py")
    protected = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(protected)
    url = protected._validated_test_database_url()
    await protected._reset_and_upgrade(url)
    engine = create_async_engine(url)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add(User(id=UUID("edb4ee80-17c6-46b5-863e-2afa18e84043"), identity_issuer="https://identity.example.test", identity_subject="t12-browser", status="active"))
        await session.commit()
    app = create_app(Settings(environment=Environment.TEST, auth_mode=AuthMode.DEVELOPMENT, dev_identity_issuer="https://identity.example.test", dev_identity_subject="t12-browser", database_url=SecretStr(url)))
    @app.get("/t12-test/effects/{ledger_id}")
    async def effects(ledger_id: UUID):
        # A separate session observes committed Correction and terminal effects before response loss.
        async with sessions() as session:
            corrections = (await session.scalars(select(FinanceAdvanceCorrection).where(FinanceAdvanceCorrection.ledger_id == ledger_id).order_by(FinanceAdvanceCorrection.revision))).all()
            terminals = (await session.scalars(select(FinanceSubmission).where(FinanceSubmission.retention_ledger_id == ledger_id, FinanceSubmission.canonical_command["operation"].astext == "createFinanceAdvanceCorrection"))).all()
            movements = (await session.execute(select(FinanceAccountMovement.account_id, FinanceAccountMovement.amount).where(FinanceAccountMovement.ledger_id == ledger_id).order_by(FinanceAccountMovement.id))).all()
            return {"producer": producer, "corrections": [{"id":str(c.id),"revision":c.revision,"plan":c.plan} for c in corrections], "commands":[{"key":str(c.submission_id),"version":c.command_version,"body":c.canonical_command,"outcome":c.terminal_outcome} for c in terminals],"movements":[{"accountId":str(m.account_id),"amount":str(m.amount)} for m in movements]}
    try:
        await uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=8299, access_log=False)).serve()
    finally:
        await engine.dispose()
if __name__ == "__main__":
    asyncio.run(main(), loop_factory=asyncio.SelectorEventLoop)

