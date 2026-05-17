from django.urls import path

from . import views

app_name = "trains"

urlpatterns = [
    path("api/arrivals", views.arrivals, name="arrivals"),
    path("api/health", views.health, name="health"),
]
