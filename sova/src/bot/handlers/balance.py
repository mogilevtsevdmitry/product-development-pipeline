from decimal import Decimal

from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account import Account
from src.bot.keyboards.common import main_menu_keyboard

router = Router(name="balance")

NO_ACCOUNTS_TEXT = (
    "🦉 У тебя пока нет счетов.\n\n"
    "Подключи ZenMoney или T-Bank в настройках, "
    "чтобы счета появились автоматически."
)


def _format_balance(accounts: list[Account]) -> str:
    """Format account balances for display."""
    lines = ["💰 *Баланс по счетам:*\n"]
    total = Decimal("0")
    for acc in accounts:
        balance = acc.balance or Decimal("0")
        total += balance
        lines.append(f"  {acc.name}: {balance:,.2f} {acc.currency}")
    lines.append(f"\n📊 Итого: {total:,.2f} ₽")
    return "\n".join(lines)


@router.message(Command("balance"))
async def cmd_balance(message: Message, db: AsyncSession) -> None:
    """Show account balances."""
    result = await db.execute(
        select(Account).where(Account.user_id == message.from_user.id)
    )
    accounts = list(result.scalars().all())

    if not accounts:
        await message.answer(NO_ACCOUNTS_TEXT)
        return

    await message.answer(_format_balance(accounts))


@router.callback_query(F.data == "menu:balance")
async def on_balance_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle balance callback from menu."""
    result = await db.execute(
        select(Account).where(Account.user_id == callback.from_user.id)
    )
    accounts = list(result.scalars().all())

    text = NO_ACCOUNTS_TEXT if not accounts else _format_balance(accounts)
    await callback.message.edit_text(text)
    await callback.answer()
