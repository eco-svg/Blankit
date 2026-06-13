# pug (Ocellus) — code reading guide

The **largest and most feature-rich distro**: a social skill-ranking network with on-device
AI, an in-app economy, DMs, and moderation. Data lives in the shared database (much of it
**encrypted at rest**), with a big single backend file and many small front-end modules.

## How it's wired in
`app.py` registers one blueprint, `pug_bp` — **every** route lives under `/pug/...`.

## Read the code in this order

1. **`extensions.py`** (tiny but read first) — the at-rest **encryption** layer. Knowing that
   note/chat text is encrypted explains the `_title`/`_body` getter/setter pattern you'll see.
2. **`routes/notes.py`** — the **data models**. Key idea: one flexible `Note` row backs many
   features, and its `entry_type` column decides what it is (note / goal / dream /
   `community_post` / `post_comment` / `post_react` / `dm` / …). Also: Wallet/EyeRate (the
   "Eyes" currency) and the moderation tables.
3. **`routes/pug_route.py`** — the entire backend (~3,700 lines). **Don't read top-to-bottom.**
   Open the file, read the module header, then use the **section banners** (big `═══` comment
   blocks) as a table of contents. Suggested path:
   - the request **helpers / auth guards** near the top,
   - then **Notes / Goals / Dreams**, **Habits**,
   - **Community feed**, **Direct messages**, **Moderation**,
   - **Skills, Stats & Ranks** (the identity system),
   - **AI endpoints** + **BlinkBot model serving**, **Eyes wallet**, **AMA**.
4. **`routes/bot_prompts.py`** + **`routes/chat_logger.py`** — the AI bots' personalities
   (system prompts) and the encrypted per-user chat log.
5. **`templates/pug/home.html`** — the app shell; then **`templates/pug/cards/_*.html`** — each
   feature is a "card" panel (`_stats`, `_social`, `_skills`, `_credits`, `_buddybot`, …).
6. **`static/` JavaScript** — start with `router.js` (how tabs/navigation work), then read a
   feature's JS alongside its card: `community.js`, `dms.js`, `stats.js`, `profile.js`,
   `blinkbot.js`, etc. **Skip `webllm.js` — it's a vendored third-party library, not our code.**

## Mental model
```
home.html  →  loads the feature cards + their JS
feature JS →  calls /pug/api/...  (router.js handles tab switching)
pug_route  →  handler → notes.py models (encrypted)  →  shared database
media      →  object storage (MinIO/B2)
AI         →  BlinkBot (in the browser via WebLLM) or Groq (cloud)
```
Start with `extensions.py` (encryption) and `notes.py` (the flexible `Note` model); once the
`entry_type` trick clicks, the rest of `pug_route.py` reads quickly section by section.
