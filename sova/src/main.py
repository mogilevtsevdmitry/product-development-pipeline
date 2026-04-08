from fastapi import FastAPI
from src.api.router import api_router

app = FastAPI(title="Sova", version="0.1.0")
app.include_router(api_router)
