from django.urls import path

from . import views

app_name = "trains"

urlpatterns = [
    # SPA shell at the root, /setup, and /display. Client-side routing handles
    # the rest. Deep-linked share URLs (/display?s=cx611) still work — the SPA
    # reads window.location.search after mounting.
    path("", views.spa_shell, name="home"),
    path("setup", views.spa_shell, name="setup"),
    path("display", views.spa_shell, name="display"),

    path("api/arrivals", views.arrivals, name="arrivals"),
    path("api/health", views.health, name="health"),
    path("api/stations", views.api_stations, name="api_stations"),
    path("api/display", views.api_display, name="api_display"),
    path("api/display/stream", views.api_display_stream, name="api_display_stream"),
]
