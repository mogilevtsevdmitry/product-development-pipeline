import pytest
from decimal import Decimal
from datetime import date
from sqlalchemy import select

from src.models.user import User
from src.models.category import Category
from src.models.transaction import Transaction
from src.services.user_service import UserService
from src.bot.handlers.expense import handle_expense_text


@pytest.fixture
async def expense_user(db):
    service = UserService(db)
    user, _ = await service.get_or_create(700001, "expense", "E")
    # Create default categories
    for name, icon in [("Еда", "🍔"), ("Транспорт", "🚕"), ("Другое", "📦")]:
        db.add(Category(name=name, icon=icon, type="expense"))
    await db.commit()
    return user


async def test_expense_text_parsed(db, make_message, expense_user):
    """Valid expense text should create a transaction."""
    msg = make_message(text="кофе 350", user_id=700001)
    await handle_expense_text(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    assert "350" in call_text
    assert "Еда" in call_text or "кофе" in call_text

    # Verify transaction was created
    result = await db.execute(
        select(Transaction).where(Transaction.user_id == 700001)
    )
    tx = result.scalar_one()
    assert tx.amount == Decimal("-350.00")


async def test_expense_text_with_tag(db, make_message, expense_user):
    """Expense with tag should be recorded."""
    msg = make_message(text="такси 600 работа", user_id=700001)
    await handle_expense_text(msg, db=db)

    msg.answer.assert_called_once()
    result = await db.execute(
        select(Transaction).where(Transaction.user_id == 700001)
    )
    tx = result.scalar_one()
    assert "#работа" in tx.description


async def test_expense_text_not_parsed(db, make_message, expense_user):
    """Non-expense text should be silently ignored."""
    msg = make_message(text="привет как дела", user_id=700001)
    await handle_expense_text(msg, db=db)

    # Should not answer for unparseable text (handler returns without responding)
    msg.answer.assert_not_called()
