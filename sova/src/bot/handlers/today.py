from datetime import date
from decimal import Decimal

from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.transaction import Transaction

router = Router(name="today")

NO_EXPENSES_TEXT = "🦉 Сегодня трат нет. Хороший день для экономии!"


def _format_today(transactions: list[Transaction]) -> str:
    """Format today's expenses for display."""
    total = sum(abs(tx.amount) for tx in transactions)
    lines = [f"📊 *Траты за сегодня:* {total:,.2f} ₽\n"]
    for tx in transactions:
        desc = tx.description or "Без описания"
        lines.append(f"  • {desc}: {abs(tx.amount):,.2f} ₽")
    lines.append(f"\nВсего операций: {len(transactions)}")
    return "\n".join(lines)


async def _get_today_text(db: AsyncSession, user_id: int) -> str:
    result = await db.execute(
        select(Transaction).where(
            Transaction.user_id == user_id,
            Transaction.date == date.today(),
            Transaction.amount < 0,
        ).order_by(Transaction.created_at.desc())
    )
    transactions = list(result.scalars().all())
    if not transactions:
        return NO_EXPENSES_TEXT
    return _format_today(transactions)


@router.message(Command("today"))
async def cmd_today(message: Message, db: AsyncSession) -> None:
    """Show today's expenses."""
    text = await _get_today_text(db, message.from_user.id)
    await message.answer(text)


@router.callback_query(F.data == "menu:today")
async def on_today_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle today callback from menu."""
    text = await _get_today_text(db, callback.from_user.id)
    await callback.message.edit_text(text)
    await callback.answer()
