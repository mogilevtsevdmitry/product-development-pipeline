from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.user_service import UserService

router = Router(name="invite")

INVITE_TEXT = (
    "🦉 *Пригласи друга в Сову!*\n\n"
    "Когда друг зарегистрируется по твоей ссылке, "
    "вы оба получите 50₽ на AI-баланс.\n\n"
    "🔗 Твоя ссылка:\n"
    "https://t.me/SovaFinBot?start=ref_{code}\n\n"
    "📊 Приглашено: {count}/10\n\n"
    "💡 Поделись ссылкой с друзьями!"
)


@router.message(Command("invite"))
async def cmd_invite(message: Message, db: AsyncSession) -> None:
    """Show referral link and stats."""
    service = UserService(db)
    user = await service.get_by_id(message.from_user.id)

    if user is None:
        await message.answer("🦉 Сначала отправь /start для регистрации.")
        return

    await message.answer(
        INVITE_TEXT.format(
            code=user.referral_code,
            count=user.referral_count,
        )
    )
