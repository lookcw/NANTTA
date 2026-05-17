import os
import sys

from django.apps import AppConfig


class TrainsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "trains"

    def ready(self) -> None:
        # Don't start the background poller in management commands like
        # ``migrate`` / ``collectstatic`` / ``makemigrations``. Only start it
        # when actually serving requests (or when explicitly opted in).
        argv = sys.argv
        is_runserver = len(argv) >= 2 and argv[1] == "runserver"
        is_wsgi = os.environ.get("NANTTA_RUN_POLLER") == "1"
        if not (is_runserver or is_wsgi):
            return

        # Django's autoreloader spawns a child process; only run the poller in
        # the child to avoid duplicate schedulers.
        if is_runserver and os.environ.get("RUN_MAIN") != "true":
            return

        from . import poller
        poller.start()
