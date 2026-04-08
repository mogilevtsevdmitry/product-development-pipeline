from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from sqlalchemy.ext.asyncio import AsyncSession

from src.bot.keyboards.common import main_menu_keyboard

router = Router(name="menu")

MENU_TEXT = "🦉 Главное меню — выбери раздел:"

COMING_SOON_TEXT = {
    "menu:portfolio": "📈 *Портфель*\n\nРаздел будет доступен после подключения T-Bank.",
    "menu:goals": "🎯 *Цели*\n\nУправление целями будет доступно в следующем обновлении.",
    "menu:ai_balance": "💎 *AI-баланс*\n\nУправление балансом будет доступно в следующем обновлении.",
}


@router.message(Command("menu"))
async def cmd_menu(message: Message, db: AsyncSession) -> None:
    """Show main menu with inline keyboard."""
    await message.answer(MENU_TEXT, reply_markup=main_menu_keyboard())


@router.callback_query(F.data == "menu:back")
async def on_menu_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle back-to-menu navigation."""
    await callback.message.edit_text(MENU_TEXT, reply_markup=main_menu_keyboard())
    await callback.answer()


@router.callback_query(F.data.in_({"menu:portfolio", "menu:goals", "menu:ai_balance"}))
async def on_coming_soon(callback: CallbackQuery, db: AsyncSession) -> None:
    """Stub handler for not-yet-implemented menu sections."""
    text = COMING_SOON_TEXT.get(callback.data, "🔧 Раздел в разработке")
    await callback.message.edit_text(text, reply_markup=main_menu_keyboard())
    await callback.answer()
