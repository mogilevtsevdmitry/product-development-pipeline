from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from sqlalchemy.ext.asyncio import AsyncSession

router = Router(name="help")

HELP_TEXT = (
    "🦉 *Что умеет Сова:*\n\n"
    "📝 *Быстрый ввод расходов*\n"
    "Просто напиши: «кофе 350» или «такси 600 работа»\n\n"
    "📋 *Команды:*\n"
    "/menu — главное меню\n"
    "/balance — баланс по счетам\n"
    "/today — траты за сегодня\n"
    "/invite — пригласить друга\n"
    "/help — эта справка\n\n"
    "🔗 *Интеграции:*\n"
    "Подключи ZenMoney или T-Bank для автоматического импорта транзакций.\n\n"
    "🤖 *AI-функции:*\n"
    "Спроси «Что с моими финансами?» или «Куда уходят деньги?» "
    "для AI-аналитики (платные запросы).\n\n"
    "💡 Вопросы? Напиши @sova_support"
)


@router.message(Command("help"))
async def cmd_help(message: Message, db: AsyncSession) -> None:
    """Show help text."""
    await message.answer(HELP_TEXT)


@router.callback_query(F.data == "menu:help")
async def on_help_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle help callback from menu."""
    await callback.message.edit_text(HELP_TEXT)
    await callback.answer()
