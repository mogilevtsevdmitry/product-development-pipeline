import pytest
from datetime import date, datetime, timezone
from decimal import Decimal
from sqlalchemy import select

from src.models.user import User
from src.models.category import Category
from src.models.transaction import Transaction
from src.services.transaction_service import TransactionService


@pytest.fixture
async def user_with_categories(db):
    """Create a test user and some categories."""
    user = User(telegram_id=200001, username="txuser", first_name="Tx")
    db.add(user)

    categories = [
        Category(name="Еда", icon="🍔", type="expense"),
        Category(name="Транспорт", icon="🚕", type="expense"),
        Category(name="Другое", icon="📦", type="expense"),
    ]
    for cat in categories:
        db.add(cat)
    await db.commit()
    return user, {c.name: c for c in categories}


async def test_create_expense(db, user_with_categories):
    user, cats = user_with_categories
    service = TransactionService(db)

    tx = await service.create_expense(
        user_id=user.telegram_id,
        amount=350.0,
        description="кофе",
        category_name="Еда",
    )
    assert tx is not None
    assert tx.amount == Decimal("-350.00")
    assert tx.source == "manual"
    assert tx.category_id == cats["Еда"].id


async def test_create_expense_unknown_category(db, user_with_categories):
    user, cats = user_with_categories
    service = TransactionService(db)

    tx = await service.create_expense(
        user_id=user.telegram_id,
        amount=100.0,
        description="штука",
        category_name="Несуществующая",
    )
    # Should create with "Другое" category
    assert tx is not None
    assert tx.category_id == cats["Другое"].id


async def test_create_expense_no_categories_exist(db):
    user = User(telegram_id=200002, username="nocats", first_name="No")
    db.add(user)
    await db.commit()

    service = TransactionService(db)
    tx = await service.create_expense(
        user_id=200002,
        amount=500.0,
        description="что-то",
        category_name="Еда",
    )
    # Should create without category
    assert tx is not None
    assert tx.category_id is None


async def test_get_today_expenses(db, user_with_categories):
    user, cats = user_with_categories
    service = TransactionService(db)

    # Create two expenses for today
    await service.create_expense(user.telegram_id, 350.0, "кофе", "Еда")
    await service.create_expense(user.telegram_id, 600.0, "такси", "Транспорт")

    expenses = await service.get_today_expenses(user.telegram_id)
    assert len(expenses) == 2
    total = sum(abs(e.amount) for e in expenses)
    assert total == Decimal("950.00")


async def test_get_today_expenses_empty(db):
    user = User(telegram_id=200003, username="empty", first_name="E")
    db.add(user)
    await db.commit()

    service = TransactionService(db)
    expenses = await service.get_today_expenses(200003)
    assert expenses == []
