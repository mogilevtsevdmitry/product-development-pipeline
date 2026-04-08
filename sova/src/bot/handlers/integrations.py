"""Bot handlers for integration management (ZenMoney, T-Bank Invest)."""
from aiogram import Router, F
from aiogram.types import CallbackQuery, Message, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.zenmoney.oauth import ZenMoneyOAuth
from src.bot.keyboards.common import integrations_keyboard, settings_keyboard

router = Router(name="integrations")


class TBankTokenState(StatesGroup):
    waiting_token = State()


async def _get_integration_statuses(db: AsyncSession, user_id: int) -> tuple[str | None, str | None]:
    """Get current integration statuses for a user."""
    encryption = EncryptionService(settings.encryption_key)
    svc = IntegrationService(db, encryption)

    zm = await svc.get(user_id, "zenmoney")
    tb = await svc.get(user_id, "tbank_invest")

    zm_status = zm.status if zm else None
    tb_status = tb.status if tb else None
    return zm_status, tb_status


# --- Show integrations ---

@router.callback_query(F.data == "settings:integrations")
async def on_integrations(callback: CallbackQuery, db: AsyncSession) -> None:
    """Show integration status and connect buttons."""
    zm_status, tb_status = await _get_integration_statuses(db, callback.from_user.id)

    text = "🏦 *Интеграции:*\n\n"
    if zm_status == "active":
        text += "✅ ZenMoney — подключён\n"
    elif zm_status == "error":
        text += "⚠️ ZenMoney — ошибка синхронизации\n"
    else:
        text += "⬜ ZenMoney — не подключён\n"

    if tb_status == "active":
        text += "✅ T-Bank Invest — подключён\n"
    elif tb_status == "error":
        text += "⚠️ T-Bank Invest — ошибка синхронизации\n"
    else:
        text += "⬜ T-Bank Invest — не подключён\n"

    await callback.message.edit_text(
        text,
        reply_markup=integrations_keyboard(zm_status, tb_status),
    )
    await callback.answer()


# --- ZenMoney Connect ---

@router.callback_query(F.data.in_({"integration:zm_connect", "integration:zm_reconnect", "integration:zenmoney"}))
async def on_zm_connect(callback: CallbackQuery, db: AsyncSession) -> None:
    """Start ZenMoney OAuth flow — send authorization URL."""
    oauth = ZenMoneyOAuth(
        consumer_key=settings.zenmoney_consumer_key,
        consumer_secret=settings.zenmoney_consumer_secret,
        redirect_uri=settings.zenmoney_redirect_uri,
    )
    auth_url = oauth.build_auth_url(state=str(callback.from_user.id))

    await callback.message.edit_text(
        "🏦 *Подключение ZenMoney*\n\n"
        "1. Нажми на ссылку ниже\n"
        "2. Авторизуйся в ZenMoney\n"
        "3. Разреши доступ для Совы\n"
        "4. Вернись в бот — всё подключится автоматически\n\n"
        f"[🔗 Подключить ZenMoney]({auth_url})",
        parse_mode="Markdown",
    )
    await callback.answer()


# --- T-Bank Connect ---

@router.callback_query(F.data.in_({"integration:tb_connect", "integration:tb_reconnect", "integration:tbank"}))
async def on_tb_connect(callback: CallbackQuery, state: FSMContext, db: AsyncSession) -> None:
    """Start T-Bank token input flow."""
    await callback.message.edit_text(
        "💳 *Подключение T-Bank Invest*\n\n"
        "1. Откройте приложение T-Bank Инвестиции\n"
        "2. Перейдите в Настройки → Работа с API\n"
        "3. Создайте новый токен (только на чтение)\n"
        "4. Скопируйте и отправьте токен сюда\n\n"
        "⚠️ Используйте *read-only* токен для безопасности.",
        parse_mode="Markdown",
    )
    await state.set_state(TBankTokenState.waiting_token)
    await callback.answer()


@router.message(TBankTokenState.waiting_token)
async def on_tb_token_received(message: Message, state: FSMContext, db: AsyncSession) -> None:
    """Process T-Bank API token from user."""
    token = message.text.strip() if message.text else ""

    if not token or len(token) < 20:
        await message.answer("❌ Токен слишком короткий. Попробуйте ещё раз.")
        return

    encryption = EncryptionService(settings.encryption_key)
    svc = IntegrationService(db, encryption)

    # Check if already connected
    existing = await svc.get(message.from_user.id, "tbank_invest")
    if existing:
        await svc.update_tokens(existing.id, access_token=token)
        existing.status = "active"
        existing.error_count = 0
        await db.commit()
    else:
        await svc.create(
            user_id=message.from_user.id,
            integration_type="tbank_invest",
            access_token=token,
        )

    await state.clear()
    await message.answer(
        "✅ T-Bank Invest подключён!\n\n"
        "Портфель синхронизируется каждый час (7:00-23:00).\n"
        "Первая синхронизация начнётся в ближайшее время.",
    )

    # Delete the message with the token for security
    try:
        await message.delete()
    except Exception:
        pass


# --- Status details ---

@router.callback_query(F.data == "integration:zm_status")
async def on_zm_status(callback: CallbackQuery, db: AsyncSession) -> None:
    """Show ZenMoney integration details."""
    encryption = EncryptionService(settings.encryption_key)
    svc = IntegrationService(db, encryption)
    integration = await svc.get(callback.from_user.id, "zenmoney")

    if integration is None:
        await callback.answer("Не подключено")
        return

    last_sync = integration.last_synced_at.strftime("%d.%m.%Y %H:%M") if integration.last_synced_at else "ещё нет"

    await callback.message.edit_text(
        f"🏦 *ZenMoney*\n\n"
        f"Статус: {integration.status}\n"
        f"Последняя синхронизация: {last_sync}\n"
        f"Ошибок подряд: {integration.error_count}",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔄 Переподключить", callback_data="integration:zm_reconnect")],
            [InlineKeyboardButton(text="❌ Отключить", callback_data="integration:zm_disconnect")],
            [InlineKeyboardButton(text="◀️ Назад", callback_data="settings:integrations")],
        ]),
        parse_mode="Markdown",
    )
    await callback.answer()


@router.callback_query(F.data == "integration:tb_status")
async def on_tb_status(callback: CallbackQuery, db: AsyncSession) -> None:
    """Show T-Bank integration details."""
    encryption = EncryptionService(settings.encryption_key)
    svc = IntegrationService(db, encryption)
    integration = await svc.get(callback.from_user.id, "tbank_invest")

    if integration is None:
        await callback.answer("Не подключено")
        return

    last_sync = integration.last_synced_at.strftime("%d.%m.%Y %H:%M") if integration.last_synced_at else "ещё нет"

    await callback.message.edit_text(
        f"💳 *T-Bank Invest*\n\n"
        f"Статус: {integration.status}\n"
        f"Последняя синхронизация: {last_sync}\n"
        f"Ошибок подряд: {integration.error_count}",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🔄 Обновить токен", callback_data="integration:tb_reconnect")],
            [InlineKeyboardButton(text="❌ Отключить", callback_data="integration:tb_disconnect")],
            [InlineKeyboardButton(text="◀️ Назад", callback_data="settings:integrations")],
        ]),
        parse_mode="Markdown",
    )
    await callback.answer()


# --- Disconnect ---

@router.callback_query(F.data == "integration:zm_disconnect")
async def on_zm_disconnect(callback: CallbackQuery, db: AsyncSession) -> None:
    encryption = EncryptionService(settings.encryption_key)
    svc = IntegrationService(db, encryption)
    await svc.disconnect(callback.from_user.id, "zenmoney")
    await callback.message.edit_text("🏦 ZenMoney отключён.")
    await callback.answer()


@router.callback_query(F.data == "integration:tb_disconnect")
async def on_tb_disconnect(callback: CallbackQuery, db: AsyncSession) -> None:
    encryption = EncryptionService(settings.encryption_key)
    svc = IntegrationService(db, encryption)
    await svc.disconnect(callback.from_user.id, "tbank_invest")
    await callback.message.edit_text("💳 T-Bank Invest отключён.")
    await callback.answer()
