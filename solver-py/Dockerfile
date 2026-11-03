# Multi-stage / Optimized Dockerfile for Python CP-SAT Solver
FROM python:3.11-slim as base

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Install system dependencies if required
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy pyproject.toml and dependencies
COPY pyproject.toml .

# Install dependencies
RUN pip install --upgrade pip && \
    pip install ".[test]"

# Copy source code
COPY . .

EXPOSE 8000

CMD ["uvicorn", "solver_py.main:app", "--host", "0.0.0.0", "--port", "8000"]
