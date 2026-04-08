import pytest
from decimal import Decimal
from datetime import date

from src.models.user import User
from src.models.category import Category
from src.models.transaction import Transaction
from src.services.user_service import UserService
from src.bot.handlers.today import cmd_today, on_today_callback


async def test_today_no_expenses(db, make_message):
    """No expenses today should show appropriate message."""
    service = UserService(db)
    await service.get_or_create(600001, "today", "T")

    msg = make_message(text="/today", user_id=600001)
    await cmd_today(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    assert "нет" in call_text.lower() or "пусто" in call_text.lower() or "трат" in call_text.lower()


async def test_today_with_expenses(db, make_message):
    """Show today's expenses summary."""
    service = UserService(db)
    await service.get_or_create(600002, "today2", "T2")

    cat = Category(name="Еда", icon="🍔", type="expense")
    db.add(cat)
    await db.commit()

    tx1 = Transaction(
        user_id=600002, amount=Decimal("-350.00"), currency="RUB",
        date=date.today(), description="кофе", source="manual", category_id=cat.id,
    )
    tx2 = Transaction(
        user_id=600002, amount=Decimal("-600.00"), currency="RUB",
        date=date.today(), description="такси", source="manual",
    )
    db.add(tx1)
    db.add(tx2)
    await db.commit()

    msg = make_message(text="/today", user_id=600002)
    await cmd_today(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    assert "950" in call_text  # total
    assert "кофе" in call_text


async def test_today_callback(db, make_callback):
    """Menu callback for today should work."""
    service = UserService(db)
    await service.get_or_create(600003, "tcb", "T")

    cb = make_callback(data="menu:today", user_id=600003)
    await on_today_callback(cb, db=db)

    cb.message.edit_text.assert_called_once()
    cb.answer.assert_called_once()
