from fastapi import APIRouter
from src.api.health import router as health_router
from src.api.auth import router as auth_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(auth_router, tags=["auth"])
