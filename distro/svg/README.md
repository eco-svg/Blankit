# svg (Eco-Svg) — code reading guide

A **server-backed, gamified habit tracker with a voting-based community**. Unlike divyanshu,
this distro keeps its data in the shared database (via SQLAlchemy models), so you read the
**models first, then the routes**.

## How it's wired in
`app.py` registers **four** blueprints for this distro:
- `svg`            — page routes (renders HTML)            → `routes/svg_route.py`
- `api`            — data API, prefix `/api`               → `routes/api_route.py`
- `community_api`  — community/posts, prefix `/api/community` → `routes/community_route.py`
- `ai`             — AI features, prefix `/ai`             → `routes/ai_route.py`

## Read the code in this order

1. **`models/`** — the data shapes first (everything else operates on these):
   - `shared/auth/user.py` (the shared User), then `habit.py`, `habit_log.py`, `todo.py`,
     `badge.py`, `community.py`.
2. **`routes/svg_route.py`** — the page routes (home, habits, calendar, settings, …). Shows
   what screens exist and which template each renders.
3. **`routes/api_route.py`** — the data API the pages call: habits, to-dos, stats
   (today/weekly/monthly/yearly), streaks, suggestions.
4. **`routes/community_route.py`** — posts, comments, and up/down **voting** (svg's community
   uses voting, not pug-style reactions).
5. **`routes/ai_route.py`** — the chat + "insight" AI features.
6. **`services/`** — supporting logic invoked by the routes: `badge_service.py` (awarding
   badges) and `moderation.py`.
7. **`templates/svg/` + `static/`** — per-feature pages and their JS/CSS (achievements,
   calendar, community, history, manifestation, settings, support).

## Mental model
```
page route (svg_route)  →  renders a template
template's JS           →  calls /api, /api/community, or /ai
those routes            →  read/write models  →  shared database
services (badges, etc.) →  side-effects triggered by the routes
```
Start with `models/` (the nouns) and `svg_route.py` (the screens); the API routes then read
naturally as "the verbs" acting on those models.
