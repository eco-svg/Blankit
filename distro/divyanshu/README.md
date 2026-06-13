# divyanshu (CatalystCrew) — code reading guide

A **personal health/fitness dashboard**. Unlike the other two distros, almost everything
runs **in the browser using localStorage** — the backend barely exists (3 routes). So to
understand this distro you mostly read the JavaScript, not the Python.

## How it's wired in
`app.py` registers this distro's blueprint as `catalystcrew_bp`. Its only backend routes
(in `routes/droute.py`) are:
- `GET /d/home` — serve the single-page app
- `GET /d/habit-tracker` — the habit-tracker view
- `POST /d/api/coach` — proxy to the AI "coach"

Everything else (steps, goals, stats, alarms, weather…) lives client-side and persists to
the browser's localStorage. **There is no database for this distro's feature data.**

## Read the code in this order

1. **`routes/droute.py`** (tiny) — the entire backend: login guard, the 3 routes above.
2. **`templates/divyanshu/home.html`** — the one page. Scroll to the bottom: the `<script>`
   tags load the JS modules **in dependency order**, which is also the best reading order.
3. **`static/js/` — read in the page's load order:**
   1. `utils.js` — shared helper functions used everywhere.
   2. `data-manager.js` — **the "database."** Reads/writes all app data to localStorage.
      Understand this before any feature module.
   3. `profile.js`, `theme.js` — user profile + look.
   4. Feature modules (each owns one screen, all talk to `data-manager`):
      `steps.js`, `goals.js`, `stats.js`, `history.js`, `alarms.js`, `weather.js`,
      `coach.js`, `health.js`, `analytics.js`, `recurring.js`.
   5. **`app.js`** — read **last**: the orchestrator that boots and wires every module together.

## Mental model
```
home.html  →  loads utils + data-manager + feature modules + app.js
app.js     →  initialises each feature module
feature    →  reads/writes app state via data-manager.js (localStorage)
coach.js   →  the only thing that calls the backend (POST /d/api/coach)
```
Start at `data-manager.js` (the data) and `app.js` (the wiring); the feature modules then
make sense on their own.
