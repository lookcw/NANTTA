# NANTTA — Turbo → React (CSR) port

Goal: replace SSR + Turbo Stream with a CSR React SPA. Django keeps the realtime
pipeline (`cache`, `parser`, `feeds`, `poller`, `stations`, `subscriptions`) and
becomes a JSON API. CSS and visual behavior must stay byte-identical.

**TypeScript is mandatory.** All new frontend code is `.ts` / `.tsx`. No `.js`.

Each phase below is one commit (or one small PR). Phases 1–4 are additive — the
existing Turbo pages keep working until Phase 5 cuts over.

---

## Phase 1 — Backend JSON endpoints (additive)

**Commit:** `api: add JSON endpoints for stations and display payloads`

Files:
- `trains/views.py` — add `api_stations`, `api_display`. Refactor `views.setup`'s
  complex-list builder into a shared helper `_complex_catalog()`.
- `trains/render.py` — add `card_payload(sub, now, limit) -> dict` returning the
  same data that `render_card` currently bakes into HTML. Keep `render_card`
  for now (Phase 6 deletes it).
- `trains/urls.py` — wire `/api/stations`, `/api/display`.

Endpoints:
- `GET /api/stations` → `{ complexes: [...] }` (same shape as the JSON currently
  embedded in `setup.html` via `stations-data` script tag).
- `GET /api/display?s=...&m=...&n=...&f=...&d=...` →
  `{ server_now, feed_age_seconds, trains_per_card, font_size,
     subs: [{ card_id, complex_id, complex: {...}, any_show_dest, rows: [...] }] }`

Acceptance: curl both endpoints, compare against the HTML pages.
Existing pages untouched.

---

## Phase 2 — SSE endpoint emits JSON, not Turbo Streams

**Commit:** `api: add /api/display/stream that pushes JSON over SSE`

Files:
- `trains/views.py` — add `api_display_stream`. Reuses `card_payload`.
- `trains/urls.py` — wire `/api/display/stream`.

Payload per SSE message:
```
event: message
data: {"server_now": ..., "feed_age_seconds": ..., "subs": [ <same as /api/display> ]}
```

Keep `display_stream` (Turbo) alive in parallel until Phase 5.

Acceptance: `curl -N` the new endpoint and watch JSON messages arrive every ~5s.

---

## Phase 3 — Vite + React + TS scaffold

**Commit:** `frontend: scaffold Vite + React + TypeScript build`

Files:
- `package.json`, `package-lock.json`
- `vite.config.ts` — `base: '/static/trains/app/'`, `build.outDir:
  'trains/static/trains/app'`, `build.manifest: true`.
- `tsconfig.json`, `tsconfig.node.json` — strict mode on.
- `trains/frontend/index.html` — Vite entry (`<div id="app">`, module script).
- `trains/frontend/src/main.tsx` — mounts `<App />` to `#app`.
- `trains/frontend/src/App.tsx` — placeholder routing skeleton.
- `.gitignore` — `node_modules/`, `trains/static/trains/app/`.
- `.dockerignore` — `node_modules`.

No runtime change yet. Build must succeed: `npm install && npm run build` writes
hashed assets into `trains/static/trains/app/`.

---

## Phase 4a — Django SPA shell view (not yet wired to existing routes)

**Commit:** `views: add SPA shell view reading Vite manifest`

Files:
- `trains/templates/trains/spa.html` — `<div id="app">` + script/link tags from
  the Vite manifest (resolved at request time by the view).
- `trains/views.py` — `spa_shell(request)` reads `trains/static/trains/app/.vite/manifest.json`
  and injects the hashed entry/css. Falls back gracefully if missing.
- `trains/urls.py` — temporarily expose under `/v2` (`/v2`, `/v2/setup`,
  `/v2/display`, catch-all `re_path(r'^v2/.*', spa_shell)`) so we can preview the
  React app without disturbing the live Turbo pages.

Acceptance: hitting `/v2/display` returns the empty shell that boots the React
bundle.

---

## Phase 4b — Shared TS primitives

**Commit:** `frontend: shared lib for subscriptions, storage, eta, line colors`

Files (all under `trains/frontend/src/`):
- `lib/types.ts` — `Subscription`, `LineSpec`, `Complex`, `TrainRow`, `CardPayload`, …
- `lib/subscriptions.ts` — URL ↔ state parser/serializer. Ports
  `trains/subscriptions.py::parse` and `setup.js::_resolveSubFromRaw` /
  `subToUrlValue` into a single canonical implementation. Single source of
  truth.
- `lib/storage.ts` — `loadConfig()` / `saveConfig()`, handles all three legacy
  shapes from `setup.js::loadFromStorage`.
- `lib/eta.ts` — `formatEta`, `useNowTick` hook.
- `lib/lineColors.ts` — port of `setup.js`'s `LINE_COLORS` / `DARK_TEXT`
  (matches `trains/line_colors.py`).
- `lib/api.ts` — typed wrappers around `/api/stations`, `/api/display`,
  `/api/display/stream` (EventSource).
- `components/Bullet.tsx` — shared bullet component (replaces `setup.js::bullet`
  and the `.bullet` markup in `_station_card.html`).

Unit tests on `subscriptions.ts` (parse → serialize round-trip on a fixture
list) are worth doing here.

---

## Phase 4c — Setup page (React) at `/v2/setup`

**Commit:** `frontend: port Setup page to React`

Files (under `trains/frontend/src/setup/`):
- `Setup.tsx` — top-level, loads `/api/stations`, holds state.
- `Search.tsx` — search input + result list.
- `SelectedList.tsx`, `SelectedItem.tsx`, `LineRow.tsx`.
- `DisplayOptions.tsx` — trains-per-card + S/M/L toggle.
- `UrlPreview.tsx` — live URL + Copy button.

Parity checklist:
- [ ] Tokenized search with score (name prefix > line match > haystack)
- [ ] Per-line N/S/Both direction toggle
- [ ] Terminus static label for terminating lines
- [ ] Per-line "Dest. on/off"
- [ ] Per-complex `min+` minutes
- [ ] Trains-per-card numeric (1–20)
- [ ] S/M/L size toggle (persists via `state.fontSize`)
- [ ] URL preview + Copy
- [ ] Expand/collapse per row + expand-all/collapse-all
- [ ] `history.replaceState('/setup')` clean-URL behavior
- [ ] localStorage round-trip (write on every change, read on boot, all three
      legacy shapes migrate)

CSS: import existing `trains/static/trains/style.css` directly in `main.tsx` so
React app uses the same stylesheet — no class renames.

---

## Phase 4d — Display page (React) at `/v2/display`

**Commit:** `frontend: port Display page to React`

Files (under `trains/frontend/src/display/`):
- `Display.tsx` — top-level. Reads URL → localStorage round-trip → fetches
  `/api/display` → opens `/api/display/stream` EventSource → renders.
- `Card.tsx` — per-complex card. Picks chip vs train layout from
  `any_show_dest`.
- `TrainRow.tsx`, `Chip.tsx` — row variants.
- `DisplayFooter.tsx` — brand + clock + stale indicator + gear link.

Behavior parity:
- [ ] Initial render from URL params; URL with subs → write to localStorage,
      `history.replaceState('/display')`.
- [ ] Empty state when no subs (mirrors `display.html` empty section).
- [ ] Live ETA tick (1s) updates per-row labels.
- [ ] Clock ticks 1s.
- [ ] Stale indicator when `feed_age_seconds > 60`.
- [ ] Size class `display--size-{s,m,l}` applied to `<body>` (via `useEffect`).
- [ ] SSE reconnect on disconnect (EventSource handles this natively; verify).

---

## Phase 5 — Cutover

**Commit:** `views: serve React SPA at /, /setup, /display`

Files:
- `trains/urls.py` — point `/`, `/setup`, `/display` and a catch-all at
  `spa_shell`. Remove `/v2` aliases.
- `trains/views.py` — remove `setup`, `display`. Keep `api_*` and `spa_shell`.
- `Dockerfile` — add Node build stage:
  ```
  FROM node:20-slim AS frontend
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci
  COPY tsconfig*.json vite.config.ts ./
  COPY trains/frontend ./trains/frontend
  RUN npm run build

  FROM python:3.13-slim AS base
  ... (existing) ...
  COPY --from=frontend /app/trains/static/trains/app ./trains/static/trains/app
  ```

Acceptance: bookmarked URL like
`https://nantta.fly.dev/display?s=cx611:N&n=4&f=l` still works and renders the
same display.

---

## Phase 6 — Delete dead code

**Commit:** `chore: remove Turbo SSR scaffolding`

Files removed:
- `trains/templates/trains/display.html`
- `trains/templates/trains/setup.html`
- `trains/templates/trains/_station_card.html`
- `trains/static/trains/setup.js`
- `trains/static/trains/countdown.js`

Files trimmed:
- `trains/views.py` — drop `display`, `display_stream` (the Turbo SSE), `setup`
  (replaced by `spa_shell`), `_apply_legacy_hide_dest`, `_read_legacy_hide_dest`,
  `_sub_to_url_value`, `_read_n`, `_read_font_size`, the `urlencode` block.
  Legacy URL-shape support stays in the *JSON* endpoints — same param names
  (`s`, `m`, `n`, `f`, `d`) keep working — but the HTML-emitting paths go.
- `trains/render.py` — drop `render_card`. Keep `upcoming`, `feed_age_seconds`,
  `card_payload`.

Acceptance: server starts, all Phase 5 routes still work, no template or static
references resolve to the deleted files.

---

## Non-goals / out of scope

- No Redux/Zustand/React Query. Local state + a couple of hooks is enough for a
  display surface this small.
- No service worker / offline mode.
- No tests beyond a smoke test for `subscriptions.ts` round-trip.
- No design changes. CSS is untouched.
- Backend stays single-worker (APScheduler in-process).
