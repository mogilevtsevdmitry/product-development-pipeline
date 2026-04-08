import pytest
from decimal import Decimal
from datetime import date
from sqlalchemy import select
from src.models.user import User
from src.models.integration import Integration
from src.models.account import Account
from src.models.category import Category
from src.models.transaction import Transaction
from src.models.portfolio import PortfolioPosition
from src.models.goal import Goal
from src.models.billing import BillingTransaction
from src.models.trade_order import TradeOrder

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

async def test_create_category(db):
    cat = Category(name="Еда", icon="🍔", type="expense")
    db.add(cat)
    await db.commit()
    result = await db.execute(select(Category).where(Category.name == "Еда"))
    saved = result.scalar_one()
    assert saved.user_id is None
    assert saved.type == "expense"

async def test_create_transaction(db):
    user = User(telegram_id=333, username="u3", first_name="U3")
    db.add(user)
    await db.commit()
    cat = Category(name="Транспорт", icon="🚕", type="expense")
    db.add(cat)
    await db.commit()
    tx = Transaction(user_id=333, category_id=cat.id, amount=Decimal("-600.00"), currency="RUB", date=date(2026, 4, 8), description="Такси", source="manual")
    db.add(tx)
    await db.commit()
    result = await db.execute(select(Transaction).where(Transaction.user_id == 333))
    saved = result.scalar_one()
    assert saved.amount == Decimal("-600.00")
    assert saved.source == "manual"

async def test_create_portfolio_position(db):
    user = User(telegram_id=444, username="u4", first_name="U4")
    db.add(user)
    await db.commit()
    pos = PortfolioPosition(user_id=444, ticker="SBER", figi="BBG004730N88", name="Сбербанк", quantity=Decimal("10.0"), avg_price=Decimal("280.50"), current_price=Decimal("285.00"), sector="financials", asset_type="stock", currency="RUB")
    db.add(pos)
    await db.commit()
    result = await db.execute(select(PortfolioPosition).where(PortfolioPosition.user_id == 444))
    saved = result.scalar_one()
    assert saved.ticker == "SBER"
    assert saved.quantity == Decimal("10.0")

async def test_create_goal(db):
    user = User(telegram_id=555, username="u5", first_name="U5")
    db.add(user)
    await db.commit()
    goal = Goal(user_id=555, name="Отпуск", target_amount=Decimal("200000.00"))
    db.add(goal)
    await db.commit()
    result = await db.execute(select(Goal).where(Goal.user_id == 555))
    saved = result.scalar_one()
    assert saved.status == "active"
    assert saved.current_amount == Decimal("0")

async def test_create_billing_transaction(db):
    user = User(telegram_id=666, username="u6", first_name="U6")
    db.add(user)
    await db.commit()
    bt = BillingTransaction(user_id=666, type="topup", amount=Decimal("300.00"), stars_amount=150, status="completed", idempotency_key="tg_pay_001")
    db.add(bt)
    await db.commit()
    result = await db.execute(select(BillingTransaction).where(BillingTransaction.user_id == 666))
    saved = result.scalar_one()
    assert saved.type == "topup"
    assert saved.stars_amount == 150

async def test_create_trade_order(db):
    user = User(telegram_id=777, username="u7", first_name="U7")
    db.add(user)
    await db.commit()
    order = TradeOrder(user_id=777, ticker="GAZP", direction="buy", order_type="market", quantity=5)
    db.add(order)
    await db.commit()
    result = await db.execute(select(TradeOrder).where(TradeOrder.user_id == 777))
    saved = result.scalar_one()
    assert saved.status == "pending_confirmation"
    assert saved.direction == "buy"
