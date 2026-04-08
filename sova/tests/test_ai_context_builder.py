"""Tests for AI Context Builder — gathering financial data for LLM context."""

import pytest
from datetime import date, timedelta
from decimal import Decimal

from src.models.user import User
from src.models.account import Account
from src.models.goal import Goal
from src.models.transaction import Transaction
from src.models.portfolio import PortfolioPosition
from src.services.user_service import UserService
from src.services.ai.context_builder import ContextBuilder


async def _create_user(db, user_id: int = 900001) -> User:
    service = UserService(db)
    user, _ = await service.get_or_create(user_id, "ctx_test", "CT")
    return user


async def test_empty_context_for_new_user(db):
    """New user with no data should get default message."""
    await _create_user(db, 900001)
    builder = ContextBuilder(db)
    ctx = await builder.build_context(900001)
    assert "Профиль пользователя" in ctx


async def test_context_includes_user_profile(db):
    """Context should include user level and timezone."""
    user = await _create_user(db, 900002)
    builder = ContextBuilder(db)
    ctx = await builder.build_context(900002)

    assert "Новичок" in ctx  # default level is beginner
    assert "Europe/Moscow" in ctx


async def test_context_includes_financial_summary(db):
    """Context should include income/expense totals when transactions exist."""
    await _create_user(db, 900003)

    # Add some transactions
    tx1 = Transaction(
        user_id=900003, amount=Decimal("50000"), currency="RUB",
        date=date.today(), description="Зарплата", source="manual",
    )
    tx2 = Transaction(
        user_id=900003, amount=Decimal("-3500"), currency="RUB",
        date=date.today(), description="Продукты", source="manual",
    )
    db.add_all([tx1, tx2])
    await db.commit()

    builder = ContextBuilder(db)
    ctx = await builder.build_context(900003)

    assert "Финансовая сводка" in ctx
    assert "Доходы" in ctx
    assert "Расходы" in ctx


async def test_context_includes_accounts(db):
    """Context should include account balances."""
    await _create_user(db, 900004)

    acc = Account(
        user_id=900004, name="Основной счёт", currency="RUB",
        balance=Decimal("125000.50"), source="manual",
    )
    db.add(acc)
    await db.commit()

    builder = ContextBuilder(db)
    ctx = await builder.build_context(900004)

    assert "Текущие балансы" in ctx
    assert "Основной счёт" in ctx


async def test_context_includes_goals(db):
    """Context should include active goals."""
    await _create_user(db, 900005)

    goal = Goal(
        user_id=900005, name="Отпуск", target_amount=Decimal("200000"),
        current_amount=Decimal("80000"), status="active",
    )
    db.add(goal)
    await db.commit()

    builder = ContextBuilder(db)
    ctx = await builder.build_context(900005)

    assert "Активные цели" in ctx
    assert "Отпуск" in ctx
    assert "40%" in ctx  # 80000/200000 = 40%


async def test_context_includes_portfolio(db):
    """Context should include portfolio positions."""
    await _create_user(db, 900006)

    pos = PortfolioPosition(
        user_id=900006, ticker="SBER", name="Сбербанк",
        quantity=Decimal("100"), avg_price=Decimal("250"),
        current_price=Decimal("280"),
    )
    db.add(pos)
    await db.commit()

    builder = ContextBuilder(db)
    ctx = await builder.build_context(900006)

    assert "Инвестиционный портфель" in ctx
    assert "SBER" in ctx
    assert "Сбербанк" in ctx
