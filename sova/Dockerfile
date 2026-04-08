## Stage 1: Build dashboard
FROM node:20-alpine AS dashboard-builder

WORKDIR /dashboard
COPY dashboard/package.json ./
RUN npm install --ignore-scripts
COPY dashboard/ .
RUN npm run build

## Stage 2: Python app
FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml .
COPY src/ src/
RUN pip install --no-cache-dir .

COPY . .

# Copy built dashboard from stage 1
COPY --from=dashboard-builder /dashboard/dist /app/dashboard/dist

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
