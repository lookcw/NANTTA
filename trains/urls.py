from django.urls import path

from . import views

app_name = "trains"

urlpatterns = [
    path("", views.setup, name="home"),
    path("setup", views.setup, name="setup"),
    path("api/arrivals", views.arrivals, name="arrivals"),
    path("api/health", views.health, name="health"),
    path("api/stations", views.api_stations, name="api_stations"),
    path("api/display", views.api_display, name="api_display"),
    path("api/display/stream", views.api_display_stream, name="api_display_stream"),
    path("display", views.display, name="display"),
    path("display/stream", views.display_stream, name="display_stream"),
]
