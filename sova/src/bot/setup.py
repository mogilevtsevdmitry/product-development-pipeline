from aiogram import Bot, Dispatcher
from src.config import settings

bot = Bot(token=settings.bot_token) if settings.bot_token else None
dp = Dispatcher()
