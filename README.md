# Veyra — Platform & Distro Feature Guide

Veyra is one Flask backend that hosts **three independent "distros"** (separate products/skins that
share login, database, and common infrastructure but have their own routes, look, and features):

| Distro key | Brand name   | Folder              | One-line identity |
|------------|--------------|---------------------|-------------------|
| `pug`      | Ocellus      | `distro/pug/`       | Social skill-ranking network + on-device AI + in-app economy (the deepest distro, actively built) |
| `svg`      | Eco-Svg      | `distro/svg/`       | Gamified habit tracker with a voting-based community |
| `divyanshu`| CatalystCrew | `distro/divyanshu/` | Personal health/fitness dashboard (mostly client-side) |

Shared code (auth, database models, config, common templates) lives in `shared/`, and the whole thing
boots from `app.py`.

> **How to read this doc:** the `pug` section is authoritative (it's the actively-developed distro).
> The `svg` and `divyanshu` sections are mapped from their routes, templates, and scripts — accurate at
> the feature level; their owners should refine the details.

---

## Feature comparison at a glance

| Capability                         | pug (Ocellus)            | svg (Eco-Svg)         | divyanshu (CatalystCrew) |
|------------------------------------|--------------------------|-----------------------|--------------------------|
| Habit tracking                     | ✅                       | ✅                    | ✅ (client-side)         |
| To-dos / goals                     | ✅ goals, dreams         | ✅ to-dos             | ✅ goals                 |
| Streak / consistency               | ✅ consistency           | ✅ streak             | ✅ (stats/history)       |
| Stats & analytics                  | ✅ skill stat-sheet      | ✅ day/week/month/year| ✅ analytics             |
| Gamification (badges/achievements) | ✅ achievements + verify | ✅ badges, podium, challenges, leaderboard | — |
| Community feed                     | ✅ rich + marketplace    | ✅ posts + voting     | —                        |
| Direct messages                    | ✅ (+ report/block)      | —                     | —                        |
| Skill ranking system               | ✅ (S+→F, benchmarks)    | —                     | —                        |
| On-device AI                       | ✅ BlinkBot (WebLLM)     | —                     | —                        |
| Cloud AI                           | ✅ BuddyBot / Groq / AMA | ✅ chat + insight     | ✅ coach                 |
| In-app currency / wallet           | ✅ "Eyes" + marketplace  | —                     | —                        |
| Content moderation                 | ✅ report/block/NSFW filter | partial (`moderation.py`) | —                  |
| Calendar / events                  | ✅                       | ✅                    | —                        |
| Weather                            | ✅                       | —                     | ✅                       |
| Internationalisation (locales)     | ✅ 16 languages          | —                     | —                        |
| Backend dependency                 | heavy (server + DB)      | medium (server + DB)  | light (mostly localStorage) |

---

## pug (Ocellus) — the social + skills + economy distro

The flagship distro. Combines a social network, a skill-ranking identity system, on-device AI, and an
in-app economy.

- **Community feed** — posts with two types (**Blog** and **ShowOff**), comments, like/dislike reactions,
  comment pinning + comment reactions, skill tags on posts, and **ShowOff action buttons**
  (Buy / Collab / Learn / Hire) that open a DM and award skill EXP. A location **"radar"** mode ranks the
  feed by distance; user search; share. Near-realtime via 2-second version polling.
- **Direct messages** — 1:1 chat with media, read receipts, and **report + block** (DMs are otherwise
  unmoderated).
- **Skills & Stats (the core identity)** — every skill gets a rank **S+ → F**. *Metric* skills (running,
  chess, lifting…) rank against real-world benchmarks; *EXP* skills (guitar, drawing…) rank by community
  engagement. Skill classes, plus an AI-generated stat-sheet (class, personality, bio, suggestions).
- **Achievements** — log achievements and verify them (links/Strava/GitHub/media) to unlock real ranks.
- **AI** — **BlinkBot** (on-device automator served to the browser via WebLLM), **BuddyBot** (8B, premium/
  desktop), **AMA "Ask Anything"** (human-answered Q&A with an admin inbox), and a Groq cloud fallback.
- **Eyes wallet & marketplace** — in-app credits ("Eyes"): top-up (UPI QR), sell-back, FX rates,
  transaction history with cancel, and escrowed marketplace payments.
- **Moderation** — report posts (auto-hide after 3 reports), block users, an admin review queue (post +
  user/DM reports), and a **client-side NSFWJS nudity pre-filter** on image uploads.
- **Productivity** — notes, goals, dreams, habits, consistency tracker, events/calendar, weather,
  daily wisdom quotes.
- **Profile & platform** — avatar/username/password management, account deletion, student verification
  (planned), 16-language i18n, single locked dark theme, feedback.

## svg (Eco-Svg) — gamified habit tracker + voting community

Server-backed, gamification-forward.

- **Habits & to-dos** — habits with toggle, per-date to-dos, habit suggestions.
- **Streaks & stats** — streak tracking and stats across today / weekly / monthly / yearly views.
- **Gamification** — badges (with a "podium"), achievements (+ a top list), challenges you can join, and a
  leaderboard.
- **Community** — posts with comments and **up/down voting** (a different model from pug's reactions).
- **AI** — a chat endpoint and an "insight" (AI insight) feature; habit suggestions.
- **Extras** — calendar, history, manifestation, onboarding flow, settings, support, image upload.

## divyanshu (CatalystCrew) — client-side health/fitness dashboard

Runs almost entirely in the browser (localStorage); only three backend routes (`/d/home`,
`/d/habit-tracker`, `/d/api/coach`). Features live in its scripts:

- **Tracking** — steps, health metrics, recurring habits, goals, alarms.
- **Insight** — analytics, stats, history, profile, weather.
- **AI** — an AI **coach** endpoint.
- A habit tracker as the central screen.

No social feed, DMs, economy, or skill-ranking — it's a personal dashboard, not a network.

---

## Key functionality differences

- **Identity model:** `pug` is built around a *skill rank* (who you are = your ranked skills); `svg` is built
  around *streaks/badges* (gamified consistency); `divyanshu` is a *personal tracker* (no public identity).
- **Community:** `pug` = rich social + marketplace (reactions, actions, DMs, skill tags, location); `svg` =
  posts with up/down voting; `divyanshu` = none.
- **AI:** `pug` = on-device BlinkBot + cloud BuddyBot/Groq + human AMA; `svg` = cloud chat + insight;
  `divyanshu` = a single AI coach.
- **Economy:** only `pug` has currency (Eyes), a wallet, and an escrowed marketplace.
- **Backend weight:** `pug` and `svg` are server + database heavy; `divyanshu` is mostly client-side
  (localStorage), so it has the smallest backend footprint.

---

## Shared foundation (`shared/` + `app.py`)

All three distros share: user accounts & auth (email verification, password reset, OTP), the database
layer, configuration, security response headers (CSP, etc.), the PWA service worker, and common pages
(privacy, terms, under-13 guide). `app.py` wires every distro's routes together and runs idempotent
startup database migrations. See `app.py`'s top-of-file comment for the full boot sequence.
