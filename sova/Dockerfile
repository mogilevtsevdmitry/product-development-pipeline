# syntax=docker/dockerfile:1
# SEC-009: Non-root user, multi-stage build, minimal image surface

# ---- Stage 1: Build dashboard ----
FROM node:20-alpine AS dashboard-builder

WORKDIR /dashboard
COPY dashboard/package.json ./
RUN npm install --ignore-scripts
COPY dashboard/ .
RUN npm run build

# ---- Stage 2: Build Python dependencies ----
FROM python:3.12-slim AS builder

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir --prefix=/install .

# ---- Stage 3: Production runner ----
FROM python:3.12-slim AS runner

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# SEC-009: Run as non-root user
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

# Copy installed Python packages
COPY --from=builder --chown=appuser:appgroup /install /usr/local

# Copy application code
COPY --chown=appuser:appgroup pyproject.toml .
COPY --chown=appuser:appgroup alembic.ini .
COPY --chown=appuser:appgroup alembic/ alembic/
COPY --chown=appuser:appgroup src/ src/

# Copy built dashboard from stage 1
COPY --from=dashboard-builder --chown=appuser:appgroup /dashboard/dist /app/dashboard/dist

# SEC-009: Drop to non-root before any execution
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
