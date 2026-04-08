import pathlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from src.api.router import api_router
from src.config import settings

DASHBOARD_DIR = pathlib.Path(__file__).resolve().parent.parent / "dashboard" / "dist"


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

# Serve dashboard SPA — must be after all API routes
if DASHBOARD_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=str(DASHBOARD_DIR / "assets")), name="dashboard-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        """Serve dashboard SPA — any non-API path returns index.html."""
        file_path = DASHBOARD_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(DASHBOARD_DIR / "index.html"))
