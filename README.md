# NANTTA

NYC subway wall display. Subscribe to any set of stations, see live arrivals
split by direction, on one always-on screen.

- **`/setup`** — pick stations, choose Manhattan-bound / Brooklyn-bound / Both,
  set trains-per-card, toggle destinations. Outputs a shareable URL.
- **`/display?s=...`** — the wall display itself. Live updates pushed every 5s
  over Server-Sent Events with Hotwire Turbo Streams; per-second countdown
  ticks happen client-side.

No API key is required for any subway data — MTA dropped that requirement in
late 2023 and the feeds are publicly available.

## Stack

- Django 5 + Hotwire Turbo (CDN, no build step)
- APScheduler for background polling of the MTA GTFS-Realtime feeds
- WhiteNoise serves static assets in production
- gunicorn with a thread pool for long-lived SSE connections

## Local development

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver
```

Then open <http://127.0.0.1:8000/setup>.

To refresh the baked-in station metadata from the MTA:
```bash
.venv/bin/python scripts/refresh_stations.py
```

## Deploy to Fly.io

One-time setup:

```bash
# Install flyctl: https://fly.io/docs/hands-on/install-flyctl/
fly auth login

# Create the app (uses the existing fly.toml — change `app =` first if you want
# a different name). Skip the deploy that `launch` offers; we'll do it next.
fly launch --copy-config --no-deploy

# Generate a real secret key and store it as a Fly secret.
fly secrets set NANTTA_SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')"

# (Optional) Pin allowed hosts to your custom domain in addition to *.fly.dev.
fly secrets set NANTTA_ALLOWED_HOSTS="your-app-name.fly.dev,nantta.example.com"

fly deploy
```

Subsequent deploys:

```bash
fly deploy
```

The app uses a single 256MB VM in Newark (`ewr`). One gunicorn worker with 16
threads handles SSE connections; the APScheduler-based MTA poller runs in the
same process so a single VM polls the realtime feeds exactly once.

## Pointing a wall display at the deployed URL

After deploy, build a config at `https://your-app.fly.dev/setup`, copy the
resulting `/display?...` URL, and open it in any browser on the wall device.

Some kiosk-mode tips:

- **Chrome / Chromium** (Linux, macOS, Windows, ChromeOS):
  ```
  chrome --kiosk --app=https://your-app.fly.dev/display?s=...
  ```
- **iPad / iPhone**: Add to Home Screen, then open from the home icon to run in
  standalone mode. Combine with Guided Access (triple-click Side button) to
  lock the device on the page.
- **Fire tablet**: Use the Silk browser in full-screen mode, or install
  `FullyKiosk` (free tier) to lock to one URL and disable timeouts.
- **Raspberry Pi**: Use the `kweb3` browser or Chromium in `--kiosk` mode from
  a `.xinitrc` autostart line. Disable the screensaver with `xset s off; xset
  -dpms; xset s noblank`.

Refresh handling is automatic: the SSE stream reconnects on transient failures,
and a "feed stale" indicator appears in the header if the realtime feeds stop
updating for more than 60s.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NANTTA_DEBUG` | `1` (dev), `0` (Dockerfile) | Toggle Django debug mode. |
| `NANTTA_SECRET_KEY` | dev fallback | Required when debug is off. |
| `NANTTA_ALLOWED_HOSTS` | `localhost,127.0.0.1,0.0.0.0` | Comma-separated. `*.fly.dev` is added automatically in prod. |
| `NANTTA_CSRF_TRUSTED_ORIGINS` | (none) | Comma-separated absolute origins. |
| `NANTTA_POLL_SECONDS` | `10` | Realtime feed poll cadence. |
| `NANTTA_STATION_REFRESH_SECONDS` | `3600` | Stations.csv refresh cadence. |

## URL params

`/display` accepts:

- `s=<stop_id>[:N|S|*]` (repeatable) — what to show. Direction is optional;
  default is both.
- `n=<int>` — trains per card. Default 3 (or 6 if `d=0`). Max 20.
- `d=0|1` — show destination caption per row (default 1).

Examples:

```
/display?s=127:N&s=127:S&s=R31:N
/display?s=718:S&s=R09:S&s=719:S&s=F09:S&n=6&d=0
```

Look up GTFS stop IDs from `trains/data/stations.json` or
[the MTA Stations.csv](http://web.mta.info/developers/data/nyct/subway/Stations.csv).
