import pytest
from decimal import Decimal
from sqlalchemy import select
from src.models.user import User
from src.models.integration import Integration
from src.models.account import Account

async def test_create_user(db):
    user = User(telegram_id=123456789, username="testuser", first_name="Test")
    db.add(user)
    await db.commit()
    result = await db.execute(select(User).where(User.telegram_id == 123456789))
    saved = result.scalar_one()
    assert saved.username == "testuser"
    assert saved.level == "beginner"
    assert saved.ai_balance == 0
    assert saved.ai_balance_version == 0
    assert saved.timezone == "Europe/Moscow"

async def test_create_integration(db):
    user = User(telegram_id=111, username="u1", first_name="U")
    db.add(user)
    await db.commit()
    integration = Integration(user_id=111, type="zenmoney", access_token_encrypted=b"encrypted_token", status="active")
    db.add(integration)
    await db.commit()
    result = await db.execute(select(Integration).where(Integration.user_id == 111))
    saved = result.scalar_one()
    assert saved.type == "zenmoney"
    assert saved.status == "active"
    assert saved.error_count == 0

async def test_create_account(db):
    user = User(telegram_id=222, username="u2", first_name="U2")
    db.add(user)
    await db.commit()
    account = Account(user_id=222, name="Tinkoff Black", currency="RUB", balance=Decimal("50000.00"), source="zenmoney", external_id="ext_123")
    db.add(account)
    await db.commit()
    result = await db.execute(select(Account).where(Account.user_id == 222))
    saved = result.scalar_one()
    assert saved.name == "Tinkoff Black"
    assert saved.balance == Decimal("50000.00")
