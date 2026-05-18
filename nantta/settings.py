"""Django settings for nantta. Env-driven for production.

Environment variables:
    NANTTA_DEBUG=1                       — enable debug mode (default off in prod)
    NANTTA_SECRET_KEY=...                — required when DEBUG is off
    NANTTA_ALLOWED_HOSTS=a.com,b.com     — comma-separated, defaults to localhost
    NANTTA_CSRF_TRUSTED_ORIGINS=...      — comma-separated absolute URLs
    NANTTA_POLL_SECONDS=10               — MTA realtime feed poll interval
    NANTTA_STATION_REFRESH_SECONDS=3600  — Stations.csv refresh interval
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _env_bool(key: str, default: bool) -> bool:
    raw = os.environ.get(key)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_list(key: str, default: list[str]) -> list[str]:
    raw = os.environ.get(key)
    if raw is None:
        return default
    return [v.strip() for v in raw.split(",") if v.strip()]


DEBUG = _env_bool("NANTTA_DEBUG", True)

_DEV_SECRET = "django-insecure-&-=!eowb*ngo5(+p9axn)#z+&^2)-n_$(3sjlru2hs^%x=jn(+"
SECRET_KEY = os.environ.get("NANTTA_SECRET_KEY") or _DEV_SECRET
if not DEBUG and SECRET_KEY == _DEV_SECRET:
    raise RuntimeError("NANTTA_SECRET_KEY must be set when NANTTA_DEBUG is off.")

ALLOWED_HOSTS = _env_list("NANTTA_ALLOWED_HOSTS", ["localhost", "127.0.0.1", "0.0.0.0"])
if not DEBUG:
    # Fly assigns *.fly.dev hostnames; allow them by default unless overridden.
    ALLOWED_HOSTS.extend([".fly.dev"])

CSRF_TRUSTED_ORIGINS = _env_list("NANTTA_CSRF_TRUSTED_ORIGINS", [])

# Fly's edge terminates TLS and forwards X-Forwarded-Proto. Without this
# Django thinks requests are HTTP and generates incorrect absolute URLs.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")


# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "trains.apps.TrainsConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise serves the collected static files directly from gunicorn so we
    # don't need a separate static server in production. Must come right after
    # SecurityMiddleware per the WhiteNoise docs.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "nantta.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "nantta.wsgi.application"


DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "America/New_York"
USE_I18N = True
USE_TZ = True

# Static files (collected to STATIC_ROOT via `manage.py collectstatic`, served
# by WhiteNoise with content hashes for far-future caching).
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "simple": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "simple"},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django.server": {"handlers": ["console"], "level": "WARNING", "propagate": False},
    },
}
