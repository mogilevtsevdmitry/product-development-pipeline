from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.user_service import UserService
from src.bot.keyboards.common import settings_keyboard, level_keyboard, main_menu_keyboard

router = Router(name="settings")

SETTINGS_TEXT = "🔔 *Настройки:*\nВыбери, что хочешь изменить:"


@router.message(Command("settings"))
async def cmd_settings(message: Message, db: AsyncSession) -> None:
    """Show settings menu."""
    service = UserService(db)
    settings = await service.get_notification_settings(message.from_user.id)
    enabled = settings.get("enabled", True)
    await message.answer(SETTINGS_TEXT, reply_markup=settings_keyboard(enabled))


@router.callback_query(F.data == "menu:settings")
async def on_settings_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle settings from menu."""
    service = UserService(db)
    settings = await service.get_notification_settings(callback.from_user.id)
    enabled = settings.get("enabled", True)
    await callback.message.edit_text(SETTINGS_TEXT, reply_markup=settings_keyboard(enabled))
    await callback.answer()


@router.callback_query(F.data == "settings:toggle_notifications")
async def on_toggle_notifications(callback: CallbackQuery, db: AsyncSession) -> None:
    """Toggle notification on/off."""
    service = UserService(db)
    current = await service.get_notification_settings(callback.from_user.id)
    currently_enabled = current.get("enabled", True)
    new_state = not currently_enabled

    await service.toggle_notifications(callback.from_user.id, new_state)

    status = "включены ✅" if new_state else "выключены 🔕"
    await callback.message.edit_text(
        f"🔔 Уведомления {status}",
        reply_markup=settings_keyboard(new_state),
    )
    await callback.answer()


@router.callback_query(F.data == "settings:level")
async def on_change_level(callback: CallbackQuery, db: AsyncSession) -> None:
    """Show level selection."""
    await callback.message.edit_text(
        "Выбери свой уровень:",
        reply_markup=level_keyboard(),
    )
    await callback.answer()
