"""Bot handler for news — shows personalized financial news."""

from aiogram import Router, F
from aiogram.types import CallbackQuery
from sqlalchemy.ext.asyncio import AsyncSession

from src.bot.keyboards.common import main_menu_keyboard
from src.services.news.personalizer import NewsPersonalizer

router = Router(name="news")


@router.callback_query(F.data == "menu:news")
async def on_news_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Show last 5 personalized news items."""
    user_id = callback.from_user.id
    personalizer = NewsPersonalizer(db)
    news_items = await personalizer.get_personalized_news(user_id, limit=5)

    if not news_items:
        text = "📰 *Новости*\n\nПока нет новостей. Они появятся после следующего обновления."
        await callback.message.edit_text(text, reply_markup=main_menu_keyboard())
        await callback.answer()
        return

    lines = ["📰 *Финансовые новости*\n"]
    for i, item in enumerate(news_items, 1):
        tickers_badge = ""
        if item.affected_tickers:
            tickers_badge = " " + " ".join(f"[{t}]" for t in item.affected_tickers)
        title = item.title[:80]
        line = f"{i}. {title}{tickers_badge}"
        if item.url:
            line += f"\n   {item.url}"
        lines.append(line)

    text = "\n".join(lines)
    await callback.message.edit_text(text, reply_markup=main_menu_keyboard())
    await callback.answer()
