"""OAuth callback endpoint for ZenMoney integration.

Handles the redirect after user authorizes ZenMoney access.
Exchanges auth code for tokens, encrypts and stores them.
"""
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Query, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_db
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.zenmoney.oauth import ZenMoneyOAuth

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/oauth", tags=["oauth"])


@router.get("/zenmoney/callback")
async def zenmoney_oauth_callback(
    code: str = Query(default=None),
    state: str = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Handle ZenMoney OAuth callback.

    Args:
        code: Authorization code from ZenMoney.
        state: User's telegram_id (passed during auth URL generation).
    """
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    if not state:
        raise HTTPException(status_code=400, detail="Missing state parameter")

    try:
        user_id = int(state)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid state parameter")

    # Exchange code for tokens
    oauth = ZenMoneyOAuth(
        consumer_key=settings.zenmoney_consumer_key,
        consumer_secret=settings.zenmoney_consumer_secret,
        redirect_uri=settings.zenmoney_redirect_uri,
    )

    try:
        tokens = await oauth.exchange_code(code)
    except Exception as e:
        logger.error("ZenMoney OAuth exchange failed: %s", e)
        raise HTTPException(status_code=502, detail="Failed to exchange authorization code")

    # Store encrypted tokens
    encryption = EncryptionService(settings.encryption_key)
    integration_service = IntegrationService(db, encryption)

    # Check if integration already exists
    existing = await integration_service.get(user_id, "zenmoney")
    if existing:
        # Update tokens
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 3600))
        await integration_service.update_tokens(
            existing.id,
            access_token=tokens["access_token"],
            refresh_token=tokens.get("refresh_token"),
            expires_at=expires_at,
        )
        # Re-activate if was disconnected
        existing.status = "active"
        existing.error_count = 0
        await db.commit()
    else:
        await integration_service.create(
            user_id=user_id,
            integration_type="zenmoney",
            access_token=tokens["access_token"],
            refresh_token=tokens.get("refresh_token"),
            token_expires_at=datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 3600)),
        )

    return {
        "status": "connected",
        "message": "ZenMoney подключён! Вернитесь в Telegram-бот.",
    }
