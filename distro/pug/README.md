# pug (Ocellus) — code reading & study guide

> This is a guide for **future-you** coming back to study this code. It tells you
> *what each piece is, what order to read it in, and where to go next.* Read it top to
> bottom once; after that, jump to the "File map" and "Backend table of contents" sections.

**pug** (brand name **Ocellus**) is the largest, most feature-rich distro on the Veyra
platform: a social skill-ranking network with on-device AI, an in-app currency, DMs,
moderation, habit/goal tracking, a calendar, and a body-measurement ("Physique") tool.

It is **one Flask blueprint** (`pug_bp`) — every URL starts with `/pug/...` — plus **one
big HTML page** (`home.html`) whose feature panels ("cards") are shown/hidden by a tiny
client-side router. Most user text is **encrypted at rest** in the shared database.

---

## 0. Before you read code: how to run it (env, runtime spine & Docker)

The app needs a few secrets in `.env` (these are *not* in git). Without them it won't boot:

| Env var | What it's for |
|---|---|
| `SECRET_KEY` | signs the login session cookie (app refuses to start in prod without it) |
| `VEYRA_KEY` | the Fernet key that encrypts notes/chats at rest (mandatory — see `extensions.py`) |
| `DATABASE_URL` | Postgres (Supabase) connection string; falls back to local SQLite if unset |
| `MAIL_USERNAME` / `MAIL_PASSWORD` | Gmail SMTP for verification codes & password resets |
| `MINIO_*` | object-storage creds (in prod these are the Backblaze B2 creds; locally a MinIO container) |
| `BLINKBOT_MODEL_URL` | absolute URL the browser streams BlinkBot's GGUF weights from (B2) |
| `GROQ_API_KEY` | cloud-AI fallback |
| `PUG_ADMIN_EMAILS` | comma-list of admin accounts (moderation, AMA inbox, Physique, Visits) |

Run (dev): `python app.py` (from the repo root) → serves on `http://localhost:7860`.
⚠️ Even in local dev, `DATABASE_URL` usually points at the **live Supabase DB**, so writes
hit real data. See the project memory note on the database.

### The runtime spine — what actually boots the distro

These files live *outside* `distro/pug/`, but they're the platform plumbing every distro runs
on. **To run "only" pug you still boot the whole app — pug is just one registered blueprint.**

- **`app.py`** (repo root) — the **application factory**, `create_app()`. Its boot sequence:
  1. wrap in `ProxyFix` (so client IPs/HTTPS are read correctly behind Render's proxy),
  2. load `Config`, then set `SECRET_KEY` (**hard-fails in prod if unset** — no forgeable sessions),
  3. normalize `DATABASE_URL` (`postgres://` → `postgresql://`) + set the 50 MB upload cap,
  4. `init_app` the database, mail, and rate-limiter,
  5. **register every distro's blueprint** (svg, api, ai, community, auth, catalystcrew, **`pug_bp`**),
  6. install the request hooks: per-request **CSP nonce**, **CSRF origin check**, dead-session
     kick-out, **security headers** (HSTS, X-Frame, Permissions-Policy, CSP), the privacy-light
     **visit counter**, and the COOP/COEP **cross-origin isolation** that's scoped to `pug.home`
     (so BlinkBot's in-browser model can run multi-threaded),
  7. SEO routes (`/robots.txt`, `/sitemap.xml`), the PWA `/sw.js`, `/favicon.ico`, legal pages,
  8. inside an app context: `db.create_all()` → **idempotent startup migrations** (`_migrate_*`,
     `_sync_sequences`) that patch the live schema on every boot → `seed_badges()` → `refresh_eye_rates()`.

  The `if __name__ == '__main__'` block at the bottom runs Flask's **dev** server. In production
  **gunicorn calls `create_app()` directly** (see the Dockerfile `CMD`) — that `__main__` block is skipped.

- **`shared/config.py`** — the `Config` class create_app() loads. Every setting comes from an
  env var (via `.env` in dev): `SECRET_KEY`, `DATABASE_URL`, session-cookie hardening
  (HttpOnly / SameSite=Lax / Secure-outside-dev / 30-day lifetime), and the Flask-Mail SMTP config.
  No secrets are hard-coded.

- **`shared/extensions.py`** — the shared **`db`** (SQLAlchemy) and **`limiter`** (rate limiter)
  instances, created *unconfigured* here and bound to the app in create_app(). Living in their
  own module is what avoids circular imports between `app.py` and the model/route files.

- **`distro/pug/extensions.py`** — pug's **Fernet at-rest encryption** (`VEYRA_KEY`). The app
  refuses to start without the key (no insecure fallback).

- **`requirements.txt`** — pinned deps: the Flask 3 stack, SQLAlchemy 2 + alembic/Flask-Migrate,
  **gunicorn** (prod server), **psycopg2** (Postgres), **argon2/bcrypt** (password hashing),
  **cryptography** (Fernet), **minio** (object storage), **groq** (cloud AI), pillow, Flask-Limiter/Mail.

- **`.env`** — the actual secret values (NOT in git). Must exist before boot.

### Dockerfile — how the container is built & run (prod = Render)

Step by step:

1. `FROM python:3.11-slim` — a small Python base image.
2. `apt-get install libopenblas0 libpq-dev` — BLAS (CPU math) + the Postgres client headers psycopg2 needs.
3. Copy `requirements.txt`, then `pip install` **everything except `llama-cpp-python`** (it's `grep`-ed out first).
4. Try to install `llama-cpp-python` separately from a **prebuilt CPU wheel** index; if the wheel
   isn't available, **skip it instead of failing the build** (`|| echo …`). It only powers *optional*
   server-side inference — production serves BlinkBot's weights to the *browser* from B2, so it isn't needed.
5. `COPY . .` — copy the whole repo into the image.
6. At **build time**, download the vendored **`webllm.js`** bundle from jsdelivr into
   `distro/pug/static/` — it's too large for git without LFS, which is why it isn't committed.
7. `EXPOSE 7860`.
8. `CMD gunicorn … app:create_app()` — start **gunicorn** (2 workers × 4 threads, gthread,
   120 s timeout) pointing at the factory. This is the production entry point — *not* `python app.py`.

**Deploy** = `git push origin master` → Render rebuilds from this Dockerfile (see the deploy memory).
The container reads its secrets from Render's env vars, not from a committed `.env`.

---

## 1. The mental model (read this first)

```
                         ┌─────────────────────────────────────────┐
  Browser (one page)     │  home.html  =  every feature's "card"    │
                         │  all loaded at once, most hidden         │
                         └───────────────┬─────────────────────────┘
        router.js shows/hides cards      │  feature JS calls fetch('/pug/api/...')
                                         ▼
                         ┌─────────────────────────────────────────┐
  Flask backend          │  pug_route.py  (one giant file)          │
  (blueprint pug_bp)     │  handler → models in notes.py            │
                         └───────┬───────────────────┬─────────────┘
                                 ▼                   ▼
                   notes.py models           object storage (MinIO/B2)
                   (encrypted via              for images / video
                    extensions.py)
                                 ▼
                         shared Postgres DB (the `users` table is shared
                         across all 3 distros; see ../../shared/)

  AI:  BlinkBot runs IN THE BROWSER (WebLLM/wllama, weights from B2)
       or falls back to Groq (cloud). Backend just assembles context + serves weights.
```

**The one trick that unlocks everything:** there is a single, heavily-reused DB row type,
`Note` (in `notes.py`). Its `entry_type` column decides *what it is* — a personal note, a
goal, a dream, a community post, a comment, a reaction, a DM, even a Physique entry. Once
that clicks, most of `pug_route.py` reads quickly: it's the same model, filtered differently.

---

## 2. Read the code in this order

Each step says *why* it's next and what it unlocks.

1. **`extensions.py`** *(tiny — read first)* — the at-rest **encryption** layer (Fernet,
   keyed by `VEYRA_KEY`). Knowing text is encrypted explains the `_title`/`_body`
   getter-setter pattern you'll meet in the models.

2. **`routes/notes.py`** — the **data models** (and the "Eyes" currency FX helper). Learn
   the flexible `Note` model + its `entry_type` trick here, plus `Wallet`/`WalletTx`/
   `EyeRate` (the economy) and the moderation tables (`PostReport`, `UserBlock`,
   `UserReport`, `SharedMedia`). The privacy-light `SiteVisit`/`SiteVisitor` counters also live here.

3. **`../../shared/`** *(small, shared by all distros)* — `shared/auth/user.py` (the `users`
   table), `shared/auth/reset_token.py` (email-verify + password-reset tokens),
   `shared/auth/auth_route.py` (login/signup/verify), `shared/config.py`, `shared/extensions.py`.

4. **`routes/pug_route.py`** — the **entire backend (~5,600 lines)**. **Do NOT read it
   top-to-bottom.** Read the module docstring at the top, then jump around using the
   *Backend table of contents* below (each section has a big `# ═══` banner).

5. **`routes/bot_prompts.py`** + **`routes/chat_logger.py`** — the AI bots' personalities
   (system prompts: BlinkBot/BuddyBot/translate) and the **encrypted per-user chat log**
   (stored outside the project so the dev auto-reloader doesn't restart on every message).

6. **`templates/pug/home.html`** — the app shell, then **`templates/pug/cards/_*.html`** —
   one partial per feature card (`_notes`, `_social`, `_skills`, `_stats`, `_credits`,
   `_buddybot`, `_physique`, `_admin`, …). `_sidebar.html` is the left toolbar;
   `public_profile.html` is the logged-out/visitor profile page.

7. **`static/` JavaScript** — start with **`router.js`** (how tabs/navigation work — it's
   commented end-to-end as your front-end entry point), then read each feature's JS next to
   its card. See the File map below.
   ⚠️ **Skip `webllm.js` (14k lines) — it's a vendored third-party library, not our code.**

---

## 3. Backend table of contents (`routes/pug_route.py`)

Open the file and jump to a section by its banner. (Line numbers drift as the file grows —
treat them as "roughly here", and search the **TITLE** text if they're off.)

| ~Line | Section | What's there |
|---|---|---|
| top | module docstring | overview + the conventions used everywhere |
| ~1301 | **REQUEST HELPERS** | `login_required_api()`, `admin_required_api()`, object-storage bucket — the auth guards almost every endpoint starts with |
| ~1416 | **PAGES** | `/pug/home` (renders the shell) |
| ~1450 | **NOTES / GOALS / DREAMS** | personal entries (encrypted) — the canonical `Note` CRUD |
| ~1614 | **CONSISTENCY & EVENTS** | habit history + calendar events; *Physique* API lives in here (~1711, stored encrypted) |
| ~1821 | **MEDIA UPLOADS & SERVING** | images/video → object storage; DM media is access-scoped |
| ~1985 | **LOCATION & PUBLIC PROFILE** | geo radar + the `/u/<username>` public profile |
| ~2052 | **AI ENDPOINTS** | Ask / BlinkBot / BuddyBot — context assembly + Groq fallback |
| ~2591 | **SKILLS, STATS & RANKS** | the skill-ranking identity system (ranks from static benchmarks, not AI) |
| ~2830 | **PROFILE MANAGEMENT** | username / password / delete account |
| ~3125 | **COMMUNITY FEED** | posts, comments, reactions, ShowOff actions; moderation (~3525); cross-distro (~3803) |
| ~3975 | **USER SEARCH** | find people |
| ~4003 | **DIRECT MESSAGES** | 1:1 chat |
| ~4492 | **ACHIEVEMENTS** | log & verify |
| ~4637 | **HABITS** | create / toggle / history |
| ~4764 | **PROXIES** | weather & wisdom (keeps API keys server-side) |
| ~4849 | **FEEDBACK** | user feedback inbox |
| ~4943 | **BLINKBOT MODEL SERVING** | serves the WebLLM/GGUF weights, install & download |
| ~5308 | **EYES WALLET & MARKETPLACE** | balance, top-up, sell-back, transactions |
| ~5447 | **ASK ANYTHING (AMA)** | human-answered Q&A + admin inbox |
| ~5579 | **TERMS PAGE** | the distro's terms |

---

## 4. File map — `static/` JavaScript → what it does → which card

| JS file | What it does | Pairs with card / section |
|---|---|---|
| **`router.js`** | client-side tab router (start here) | all of them |
| `i18n.js` | 16-language translation of the UI | all |
| `notes.js` | personal notes CRUD | `_notes` |
| `goals.js` | to-do / goals | `_notes` (To-do) |
| `calendar.js` | calendar: span/time events, holidays, "crushed day" reveals | `_notes` calendar |
| `habits.js` | habit create/toggle | `_habits` |
| `consistency.js` | habit completion charts (Chart.js) | `_habits` |
| `community.js` | the community feed (biggest JS file): posts, comments, reactions, ShowOff actions, radar | `_social` |
| `dms.js` | direct messages | `_dms` |
| `stats.js` | skills, ranks & the AI "character sheet" | `_stats` / `_skills` |
| `profile.js` | profile management (username, password, delete) | `_profile` |
| `achievements.js` | log & verify achievements | `_stats` |
| `credits.js` | the "Eyes" wallet & marketplace UI | `_credits` |
| `blinkbot.js` | BlinkBot card UI + request queue | `_buddybot` |
| `blinkbot_wllama.js` | runs BlinkBot's model in-browser (wllama; multi-thread via COI) | `_buddybot` |
| `ask.js` | the "Ask Anything" capsule | `_ask` (card currently disabled) |
| `physique.js` | body-measurement tab: 2D/3D mannequin + live camera (MediaPipe) | `_physique` |
| `admin.js` | admin/moderation panel + the Visits analytics tab | `_admin` |
| `headerbar.js` | the top "deadline bar": next event / wisdom | header slot |
| `quickactions.js` | the focus-timer quick-action card | right-bar |
| `clock.js` | the right-bar clock | right-bar |
| `guest.js` | guest-mode prompts (turn server 401s into "sign up") | — |
| `guest-store.js` | guest-mode local data layer (intercepts fetch → localStorage) | — |
| `clientlog.js` | ships caught JS errors to the server log (`window.blinkLog`) | — |
| `mobile-gate.js` | forces desktop layout on phones + "mobile soon" notice | — |
| `gaps.js`, `ani.js` | small layout/animation helpers | — |
| `webllm.js` | **vendored 3rd-party lib — do not read or edit** | — |

---

## 5. How one feature flows, end to end (worked example: posting to the feed)

1. User clicks the **Social** tab → `router.js` `navigate('social')` reveals `sec-comms`
   and fires `veyra:navigate`.
2. `community.js` loads the feed via `fetch('/pug/api/community/...')`.
3. That hits the **COMMUNITY FEED** section of `pug_route.py`, which runs
   `login_required_api()`, then reads/writes `Note` rows (with `entry_type='community_post'`)
   through `notes.py` — bodies encrypted via `extensions.py`.
4. Any image goes through **MEDIA UPLOADS** → object storage (MinIO/B2).
5. The JSON comes back and `community.js` renders the cards.

Every feature follows the same shape: **card → feature JS → `/pug/api/...` → handler →
`Note` model → DB**. Once you've traced one, you've traced them all.

---

## 6. Guest mode (logged-out visitors)

A logged-out visitor can still *use* the personal tools. `guest-store.js` loads early and
**overrides `window.fetch`**: personal endpoints (notes, goals, habits, calendar, physique,
stats) are answered from **localStorage** instead of the server, so nothing is sent to
Veyra until they sign up. Social/money endpoints are *not* intercepted — they 401, and
`guest.js` turns that into a "sign up to do this" prompt.

---

## 7. What changed since the last version of this guide

The old guide predated a lot of work. New since then:

- **Physique tab** — `physique.js` + `_physique.html` + API in `pug_route.py` (~1711). 2D/3D
  mannequin from measurements + **live on-device camera measure** (MediaPipe pose, nothing stored).
- **Guest mode** — `guest.js` + `guest-store.js` (browse + use personal tools logged-out).
- **Deadline/header bar** — `headerbar.js` (next event / wisdom in the top slot).
- **Calendar** — `calendar.js` grew span/time events, locale holidays, "crushed day" reveals.
- **Quick-actions focus timer** — `quickactions.js` (pinned at the bottom of the right-bar).
- **Privacy-light visit counter** — `SiteVisit`/`SiteVisitor` in `notes.py`, recorded in
  `app.py`, surfaced in the admin **Visits** tab (`admin.js`).
- **Mobile gate** — `mobile-gate.js` forces the desktop layout on phones for now.
- The backend grew from ~3,700 to ~5,600 lines; use the table of contents above, not a scroll.

---

## 8. Boundaries — what NOT to touch

- **Only work in `distro/pug/` + `shared/`.** The `svg` (Eco-Svg) and `divyanshu`
  (CatalystCrew) distros belong to other people — don't edit them.
- **`static/webllm.js`** is a vendored library. Never hand-edit it.
- Treat the DB as **live data** even locally (it's the shared Supabase Postgres).

