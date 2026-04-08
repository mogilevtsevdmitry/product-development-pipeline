from aiogram import Router, F
from aiogram.filters import CommandStart
from aiogram.types import Message, CallbackQuery
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.user_service import UserService
from src.services.billing_service import BillingService
from src.bot.keyboards.common import (
    consent_keyboard,
    integration_keyboard,
    level_keyboard,
    main_menu_keyboard,
)

router = Router(name="start")


WELCOME_TEXT = (
    "🦉 Привет! Я Сова — твой персональный финансовый помощник.\n\n"
    "Я помогу разобраться в финансах: отслеживать расходы, "
    "анализировать траты и управлять инвестициями.\n\n"
    "Для начала мне нужно твоё согласие на обработку данных."
)

WELCOME_BACK_TEXT = (
    "🦉 С возвращением, {name}! Вот твоё меню:"
)

CONSENT_ACCEPTED_TEXT = (
    "✅ Спасибо! Теперь выбери, хочешь ли подключить сервисы для автоматического импорта данных:"
)

INTEGRATION_STUB_TEXT = (
    "🔧 Подключение {service} будет доступно в следующем обновлении.\n\n"
    "А пока выбери свой уровень:"
)

LEVEL_SELECTED_TEXT = (
    "🦉 Отлично! Ты выбрал уровень: {level_text}.\n\n"
    "🎁 Тебе начислено 5 бесплатных AI-запросов, чтобы ты мог оценить возможности Совы.\n\n"
    "Готово! Отправь /menu чтобы открыть главное меню, "
    "или просто напиши трату — например, «кофе 350»."
)

LEVEL_NAMES = {
    "beginner": "🌱 Новичок",
    "intermediate": "📊 Веду бюджет",
    "advanced": "📈 Активный инвестор",
}


@router.message(CommandStart())
async def cmd_start(message: Message, db: AsyncSession) -> None:
    """Handle /start command — onboarding or welcome back."""
    service = UserService(db)
    user_id = message.from_user.id
    username = message.from_user.username
    first_name = message.from_user.first_name

    # Parse deep link referral code: /start ref_ABCD1234
    referral_code = None
    if message.text and " " in message.text:
        payload = message.text.split(" ", 1)[1]
        if payload.startswith("ref_"):
            referral_code = payload[4:]

    user, created = await service.get_or_create(user_id, username, first_name)

    # Handle referral if new user
    if created and referral_code:
        referrer = await service.get_by_referral_code(referral_code)
        if referrer and referrer.telegram_id != user_id:
            await service.record_referral(user_id, referrer.telegram_id)

    # Existing user with completed onboarding
    if user.onboarding_completed:
        name = first_name or username or "друг"
        await message.answer(
            WELCOME_BACK_TEXT.format(name=name),
            reply_markup=main_menu_keyboard(),
        )
        return

    # New or incomplete onboarding — show consent
    await message.answer(WELCOME_TEXT, reply_markup=consent_keyboard())


@router.callback_query(F.data == "consent:accept")
async def on_consent_accept(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle consent acceptance — record and show integration choice."""
    service = UserService(db)
    await service.set_consent(callback.from_user.id)

    await callback.message.edit_text(
        CONSENT_ACCEPTED_TEXT,
        reply_markup=integration_keyboard(),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("integration:"))
async def on_integration_choice(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle integration choice during onboarding."""
    choice = callback.data.split(":")[1]

    if choice == "skip":
        await callback.message.edit_text(
            "Выбери свой уровень финансовой грамотности:",
            reply_markup=level_keyboard(),
        )
    elif choice in ("zenmoney", "tbank"):
        service_name = "ZenMoney" if choice == "zenmoney" else "T-Bank"
        await callback.message.edit_text(
            INTEGRATION_STUB_TEXT.format(service=service_name),
            reply_markup=level_keyboard(),
        )

    await callback.answer()


@router.callback_query(F.data.startswith("level:"))
async def on_level_select(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle level selection — complete onboarding."""
    level = callback.data.split(":")[1]
    service = UserService(db)

    await service.update_level(callback.from_user.id, level)
    await service.complete_onboarding(callback.from_user.id)

    # Grant 5 free AI credits (50₽)
    billing = BillingService(db)
    await billing.grant_free_credits(callback.from_user.id)

    level_text = LEVEL_NAMES.get(level, level)
    await callback.message.edit_text(LEVEL_SELECTED_TEXT.format(level_text=level_text))
    await callback.answer()
