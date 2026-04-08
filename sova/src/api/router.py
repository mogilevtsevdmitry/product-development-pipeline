from fastapi import APIRouter
from src.api.health import router as health_router
from src.api.auth import router as auth_router
from src.api.oauth_callback import router as oauth_router
from src.api.dashboard import router as dashboard_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(auth_router, tags=["auth"])
api_router.include_router(oauth_router)
api_router.include_router(dashboard_router, tags=["dashboard"])
