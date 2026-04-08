from aiogram import Bot, Dispatcher, Router
from aiogram.types import Update
from fastapi import FastAPI, Request

from src.config import settings
from src.database import async_session
from src.bot.middlewares.db_session import DbSessionMiddleware


def _create_bot() -> Bot | None:
    """Create Bot instance, returning None if token is not configured."""
    token = settings.bot_token
    if not token or len(token) < 10:
        return None
    try:
        return Bot(token=token)
    except Exception:
        return None


# Bot instance (None if no token configured — for testing)
bot = _create_bot()

# Dispatcher with router
dp = Dispatcher()

# Main router — all handler routers will be included here
main_router = Router(name="main")
dp.include_router(main_router)

# Register DB session middleware
dp.update.middleware(DbSessionMiddleware(session_pool=async_session))

_handlers_registered = False


def register_handlers() -> None:
    """Import and register all handler routers.

    Called during app startup to avoid circular imports.
    """
    global _handlers_registered
    if _handlers_registered:
        return
    _handlers_registered = True

    from src.bot.handlers.start import router as start_router
    from src.bot.handlers.menu import router as menu_router
    from src.bot.handlers.balance import router as balance_router
    from src.bot.handlers.today import router as today_router
    from src.bot.handlers.help import router as help_router
    from src.bot.handlers.expense import router as expense_router
    from src.bot.handlers.invite import router as invite_router
    from src.bot.handlers.settings import router as settings_router
    from src.bot.handlers.integrations import router as integrations_router
    from src.bot.handlers.billing import router as billing_router
    from src.bot.handlers.ai import router as ai_router

    main_router.include_router(start_router)
    main_router.include_router(menu_router)
    main_router.include_router(balance_router)
    main_router.include_router(today_router)
    main_router.include_router(help_router)
    main_router.include_router(invite_router)
    main_router.include_router(settings_router)
    main_router.include_router(integrations_router)
    main_router.include_router(billing_router)
    # AI router catches AI-intent text messages before expense router
    main_router.include_router(ai_router)
    # Expense router is last — it catches plain text messages
    main_router.include_router(expense_router)


_webhook_registered = False


def setup_webhook_route(app: FastAPI) -> None:
    """Register the webhook endpoint on the FastAPI app."""
    global _webhook_registered
    if _webhook_registered:
        return
    _webhook_registered = True

    @app.post(settings.webhook_path)
    async def bot_webhook(request: Request):
        if bot is None:
            return {"ok": False, "error": "Bot not configured"}
        update = Update.model_validate(await request.json(), context={"bot": bot})
        await dp.feed_update(bot=bot, update=update)
        return {"ok": True}
