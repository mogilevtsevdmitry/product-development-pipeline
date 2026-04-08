from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.api.router import api_router
from src.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App lifespan: setup bot webhook on startup, cleanup on shutdown."""
    from src.bot.setup import bot

    # Set webhook if bot is configured and base URL is not localhost
    if bot and "localhost" not in settings.app_base_url:
        webhook_url = f"{settings.app_base_url}{settings.webhook_path}"
        await bot.set_webhook(webhook_url)

    yield

    # Cleanup
    if bot:
        await bot.session.close()


app = FastAPI(title="Sova", version="0.1.0", lifespan=lifespan)
app.include_router(api_router)

# Register bot handlers and webhook route at import time
from src.bot.setup import register_handlers, setup_webhook_route  # noqa: E402

register_handlers()
setup_webhook_route(app)
