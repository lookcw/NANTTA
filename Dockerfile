# syntax=docker/dockerfile:1.7
FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000

# System deps: we only need ca-certs for outbound HTTPS to the MTA feeds.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so that source changes don't bust the layer cache.
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Copy the rest of the source.
COPY . .

# Build static assets into STATIC_ROOT for WhiteNoise to serve.
RUN NANTTA_SECRET_KEY=build-only NANTTA_DEBUG=0 \
    python manage.py collectstatic --no-input

EXPOSE 8000

# gunicorn config notes:
#   --workers 1            : APScheduler runs in-process; multiple workers would
#                            each poll MTA in parallel. Keep one worker.
#   --threads 16           : SSE connections are long-lived. Threads, not async,
#                            because Django's view code is sync.
#   --worker-class gthread : enables the thread pool.
#   --timeout 0            : SSE generators never naturally exit; don't let
#                            gunicorn kill idle workers.
#   --keep-alive 65        : keep connections alive across SSE message ticks.
CMD ["sh", "-c", "python manage.py migrate --no-input && exec gunicorn nantta.wsgi:application --bind 0.0.0.0:${PORT} --workers 1 --threads 16 --worker-class gthread --timeout 0 --keep-alive 65 --access-logfile - --error-logfile -"]
