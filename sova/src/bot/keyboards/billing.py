"""Billing-related keyboards — top-up, withdrawal, AI balance."""

from decimal import Decimal
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, LabeledPrice


def ai_balance_keyboard() -> InlineKeyboardMarkup:
    """AI balance screen with top-up buttons, history, withdraw."""
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="+100₽", callback_data="billing:topup:100"),
            InlineKeyboardButton(text="+300₽", callback_data="billing:topup:300"),
            InlineKeyboardButton(text="+500₽", callback_data="billing:topup:500"),
        ],
        [
            InlineKeyboardButton(text="📜 История", callback_data="billing:history"),
            InlineKeyboardButton(text="💸 Вывод", callback_data="billing:withdraw"),
        ],
        [InlineKeyboardButton(text="◀️ Назад", callback_data="menu:back")],
    ])


def withdraw_confirm_keyboard(amount: Decimal) -> InlineKeyboardMarkup:
    """Confirmation keyboard for withdrawal."""
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text=f"✅ Подтвердить вывод {amount:.0f}₽",
                callback_data=f"billing:withdraw_confirm:{amount}",
            ),
        ],
        [InlineKeyboardButton(text="❌ Отмена", callback_data="billing:withdraw_cancel")],
    ])
