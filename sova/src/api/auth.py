import hashlib
import hmac
import time
import uuid

from fastapi import APIRouter, HTTPException
from src.config import settings

router = APIRouter(prefix="/api/auth")

_tokens: dict[str, int] = {}  # token -> telegram_id

def verify_telegram_auth(data: dict) -> bool:
    check_hash = data.pop("hash", "")
    check_data = sorted(f"{k}={v}" for k, v in data.items())
    check_string = "\n".join(check_data)
    secret_key = hashlib.sha256(settings.bot_token.encode()).digest()
    computed = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()
    data["hash"] = check_hash
    return hmac.compare_digest(computed, check_hash)

@router.post("/telegram")
async def telegram_login(data: dict):
    if not verify_telegram_auth(data):
        raise HTTPException(status_code=401, detail="Invalid auth data")
    auth_date = int(data.get("auth_date", 0))
    if time.time() - auth_date > 86400:
        raise HTTPException(status_code=401, detail="Auth data expired")
    telegram_id = int(data["id"])
    token = uuid.uuid4().hex
    _tokens[token] = telegram_id
    return {"token": token, "telegram_id": telegram_id}
