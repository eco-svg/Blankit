import json
import random
import requests
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── CONFIGURATION ──────────────────────────────────────────────────────────
API_URL          = "http://localhost:8000/v1/chat/completions"
MODEL            = "/home/jovyan/model_awq"
OUTPUT_PATH      = "/persistent/blinkbot_automator_dataset.jsonl"
TARGET           = 10000
MAX_WORKERS      = 20
MAX_TOKENS       = 2000

CORE = open("/root/blinkbot_core.txt").read()

# ── HABIT POOL ─────────────────────────────────────────────────────────────
HABITS = [
    "running", "meditation", "reading", "gym", "cold shower", "journaling",
    "guitar", "coding", "studying", "walking", "cycling", "swimming",
    "yoga", "stretching", "drinking water", "no phone morning", "sleep by 11",
    "wake up 6am", "no sugar", "intermittent fasting", "badminton", "chess",
    "drawing", "language learning", "pushups", "pull-ups", "meal prep",
    "gratitude", "no social media", "side project", "networking", "prayer"
]

SKILLS = [
    "running", "guitar", "coding", "swimming", "chess", "drawing",
    "badminton", "photography", "writing", "cooking", "powerlifting",
    "public speaking", "machine learning", "web development", "video editing"
]

GOALS = [
    "run 5 times this week", "finish chapter 10 of my book", "build a side project",
    "study 2 hours daily", "lose 3kg this month", "practice guitar 30 mins daily",
    "complete online course", "save 5000 INR", "read 2 books this month",
    "submit college assignment", "pass JEE mock test", "launch app MVP"
]

ACHIEVEMENTS = [
    "finished a personal project", "ran first 10K", "completed online course",
    "published first article", "won badminton tournament", "built a working app",
    "got first freelance client", "submitted research paper", "played first open mic",
    "completed 30-day streak", "passed difficult exam", "hit gym PR"
]

METRICS = [
    "5K in 22:14", "10K in 48:30", "5K in 19:55", "bench 100kg", "squat 120kg",
    "1500 ELO in chess", "ran 7K", "swam 1500m", "deadlift 140kg",
    "100m in 11.8s", "5K in 17:02", "pushed 80kg overhead"
]

# ── SCENARIO CATEGORIES ────────────────────────────────────────────────────
# Each category defines the TYPE of input BlinkBot must handle.
# The generator creates a realistic example for each.

SCENARIO_CATEGORIES = [

    # ── SINGLE HABIT TICKS ─────────────────────────────────────────────────
    "user ticks one habit directly by name",
    "user ticks one habit in casual language",
    "user ticks one habit after describing it briefly",
    "user ticks habit using synonym (gym = worked out, running = jogged)",
    "user ticks habit and adds time context (morning run, evening gym)",
    "user ticks habit and mentions it was harder than usual",
    "user ticks habit and mentions it was easy today",
    "user ticks habit with a metric (ran 5K, 30 mins of yoga)",
    "user ticks habit and says nothing else",

    # ── MULTI-HABIT STORIES ────────────────────────────────────────────────
    "user tells a short story covering 2 habits",
    "user tells a short story covering 3 habits",
    "user tells a story covering 4 or more habits",
    "user narrates their morning routine covering multiple habits",
    "user narrates their evening routine covering multiple habits",
    "user gives a full-day summary with 5+ habits embedded",
    "user gives a casual two-sentence day summary with 2 habits",
    "user describes a productive day, multiple habits implied",
    "user describes a lazy day, only 1 or 2 habits done",

    # ── HABIT TICKS WITH METRICS ────────────────────────────────────────────
    "user runs with a specific time — habit tick + skill flag",
    "user lifts with a specific weight — habit tick + skill flag",
    "user swims with a distance/time — habit tick + skill flag",
    "user does a sport with a score — habit tick + skill flag",
    "user mentions a personal record — habit tick + skill flag + rank request",
    "user gives metric that suggests elite performance — rank request warranted",
    "user gives metric that is average — habit tick only, no rank needed",

    # ── ACHIEVEMENT LOGGING ────────────────────────────────────────────────
    "user finishes a personal project and wants it logged",
    "user completes a course and mentions it",
    "user wins a competition and mentions it",
    "user ships something (app, article, video) and mentions it",
    "user passes an exam and mentions it",
    "user hits a gym personal record",
    "user finishes a book",
    "user completes a challenge (30 days, 100 pushups, etc.)",
    "user mentions an achievement without explicitly asking to log it",
    "user says they did something big today without details",

    # ── SKILL DETECTION ────────────────────────────────────────────────────
    "user mentions doing something repeatedly that implies a skill",
    "user describes a skill activity with clear evidence in story",
    "user gives a verifiable metric — rank request appropriate",
    "user describes skill progress without a metric — flag only, no rank",
    "user says they started learning something new — add as beginner skill",
    "user mentions a skill that is NOT in their current list",
    "user describes getting better at something over time",

    # ── NOTE LOGGING ──────────────────────────────────────────────────────
    "user explicitly asks to add a note",
    "user says something worth logging that doesn't match any habit",
    "user describes a meeting or event worth noting",
    "user wants to remember something for later",
    "user says 'note that...' directly",
    "user says something happened today with no habit match — note it",
    "user gives a reflection worth logging as a note",

    # ── GOAL TRACKING ─────────────────────────────────────────────────────
    "user updates progress on an active goal",
    "user completes an active goal",
    "user adds a new goal",
    "user mentions working toward a goal without numbers",
    "user gives specific progress numbers for a goal",
    "user says they failed to progress on a goal today",
    "user asks about their goal status",

    # ── UNDO ──────────────────────────────────────────────────────────────
    "user says undo immediately after ticking a habit",
    "user says wait undo that — casual phrasing",
    "user says actually cancel that",
    "user undoes after a note was added",
    "user undoes after an achievement was logged",
    "user tries to undo with nothing to undo",
    "user tries to undo a deletion (not possible)",
    "user asks to undo multiple times in a row",

    # ── CONFLICT / DUPLICATE ───────────────────────────────────────────────
    "user says they ran but running is already ticked today",
    "user ticks a habit that was already ticked — single habit",
    "user story includes a habit already ticked — mixed new and duplicate",
    "user contradicts a previous log (skipped meal they already logged)",
    "user says they did something but their data shows they didn't start the habit",
    "user mentions a habit that doesn't exist in their list",

    # ── AMBIGUOUS / HEDGED ────────────────────────────────────────────────
    "user says they kinda ran today",
    "user says they almost finished their habit",
    "user says they sort of did it",
    "user says they tried to do the habit but failed",
    "user uses sarcasm — implies they didn't do it",
    "user gives a vague message with unclear intent",
    "user says they did something but lists two conflicting things",
    "user's message could mean two different habits",
    "user says they did most of their routine",
    "user says they did half a session",

    # ── EMPTY / NEW USER ──────────────────────────────────────────────────
    "new user with no habits ticks something for first time",
    "user mentions habit not in their list — add and tick",
    "user has no goals and mentions working toward something — add goal",
    "user has no skills and mentions a skill activity — add and flag",
    "user has empty data and gives a full story",

    # ── QUERIES ───────────────────────────────────────────────────────────
    "user asks for today's streak on a habit",
    "user asks for a summary of today",
    "user asks how many habits they've done today",
    "user asks if they ticked a specific habit",
    "user asks what their current rank is for a skill",
    "user asks about their goal progress",
    "user asks what they've logged today",
    "user says good morning with no action",
    "user says hey or hi with no action",
    "user asks what BlinkBot can do",

    # ── PROACTIVE NUDGES ──────────────────────────────────────────────────
    "end of day, user has ticked nothing — nudge",
    "end of day, user has ticked some but not all habits — partial nudge",
    "user has a streak at risk today — warn",
    "user hasn't logged anything in 2 days — nudge",
    "user is close to completing a goal — encourage",

    # ── AD MATCHING ───────────────────────────────────────────────────────
    "user has running and gym habits — match fitness ads",
    "user has guitar and music skills — match music gear ads",
    "user has coding skill and side project goal — match tech ads",
    "user has cooking habit — match food/kitchen ads",
    "user has mixed interests (fitness + tech + music) — match multiple categories",
    "user has reading habit — match book/education ads",
    "user has photography skill — match camera/gear ads",
    "sensitive topic in user data — do NOT match health or mental wellness ads",

    # ── RANKING ───────────────────────────────────────────────────────────
    "user gives a strong running metric and asks for rank",
    "user gives a lifting metric and asks for rank",
    "user gives a chess rating and asks for rank",
    "user gives a metric with no rank request — flag only",
    "user asks for rank with no metric — reject politely",
    "user gives a weak metric — E rank, note needed",
    "user gives a world-class metric — S tier consideration",

    # ── MULTI-ACTION COMBINED ─────────────────────────────────────────────
    "user ticks habits + adds note + logs achievement in one message",
    "user ticks habits + updates goal + flags skill in one message",
    "user gives full story: habits + achievement + skill metric",
    "user gives chaotic story with 6 different action types",
    "user summarises entire week in one message",

    # ── OFFLINE / BACKEND ERRORS ──────────────────────────────────────────
    "backend is unreachable — queue local actions",
    "Groq is unavailable — local actions proceed, rank pending",
    "partial failure — some commands succeeded, one failed",
    "user tries to act with no internet — offline response",

    # ── DELETION ──────────────────────────────────────────────────────────
    "user wants to delete a habit permanently",
    "user wants to delete a habit and confirms it's permanent",
    "user wants to remove an achievement",
    "user asks to clear today's log",

    # ── EDGE CASES — LANGUAGE ─────────────────────────────────────────────
    "user speaks in very short fragmented sentences",
    "user gives a very long detailed story",
    "user mixes languages in one message (Hinglish style)",
    "user uses slang for habits (legday, cardio, morning pages)",
    "user uses abbreviations (WOD, PR, PB, 5x5)",
    "user speaks in third person about themselves",
    "user makes a typo in the habit name",
    "user refers to a habit by its number or emoji",

    # ── EDGE CASES — LOGIC ────────────────────────────────────────────────
    "user tries to tick a deleted habit",
    "user asks to undo something from yesterday",
    "user asks to retroactively tick yesterday's habits",
    "user tries to set rank manually without evidence",
    "user gives metric but it's clearly fake or impossible",
    "user asks BlinkBot to predict their future performance",
    "user asks BlinkBot to compare them to another user",
    "user asks for personal advice — redirect to BuddyBot",
    "user asks an emotional question — redirect to BuddyBot",
    "user tries to get BlinkBot to send a message to someone",
    "user asks BlinkBot to post to social — refuse",
    "user asks for data that doesn't exist",
    "user asks to export all their data",
    "user tries to inject a command via natural language",

    # ── STREAK MILESTONES ─────────────────────────────────────────────────
    "user hits 7-day streak — surface milestone",
    "user hits 30-day streak — surface milestone",
    "user hits 100-day streak — surface milestone",
    "user breaks a streak — note it plainly",
    "user asks about their longest streak",

    # ── PRIVACY EDGE CASES ────────────────────────────────────────────────
    "user mentions their full name in a note — strip from Groq",
    "user mentions their location in a story — strip from Groq",
    "user describes a DM conversation — do NOT log or route externally",
    "user pastes a social media post — do NOT route externally",
    "user shares health/medical info — local only, never to Groq",
]


# ── CONTEXT BUILDER ────────────────────────────────────────────────────────
def random_user_context():
    n_habits = random.randint(0, 8)
    selected_habits = random.sample(HABITS, min(n_habits, len(HABITS)))
    ticked = {h: random.choice([True, False]) for h in selected_habits}
    n_skills = random.randint(0, 4)
    selected_skills = random.sample(SKILLS, min(n_skills, len(SKILLS)))
    n_goals = random.randint(0, 3)
    selected_goals = random.sample(GOALS, min(n_goals, len(GOALS)))
    streak_val = random.randint(0, 120)
    last_actions = [
        "TICK_HABIT: running",
        "ADD_NOTE: great session today",
        "ADD_ACHIEVEMENT: finished side project",
        None
    ]
    ctx = f"""[USER_CONTEXT]
HABITS: {', '.join([f"{h}(ticked={ticked[h]})" for h in selected_habits]) or 'none'}
SKILLS: {', '.join(selected_skills) or 'none'}
GOALS: {', '.join(selected_goals) or 'none'}
STREAKS: {selected_habits[0] + '=' + str(streak_val) + 'days' if selected_habits else 'none'}
LAST_ACTION: {random.choice(last_actions) or 'none'}
[END_CONTEXT]"""
    return ctx


# ── MODEL CALLER ───────────────────────────────────────────────────────────
def call_model(system_prompt, user_message, max_tokens=MAX_TOKENS):
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_message}
        ],
        "max_tokens": max_tokens,
        "temperature": 0.82,
    }
    r = requests.post(API_URL, json=payload, timeout=600)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


# ── EXAMPLE BUILDER ────────────────────────────────────────────────────────
def build_example(category):
    ctx = random_user_context()

    generator_prompt = f"""You are generating training data for BlinkBot — a pure automation layer for a productivity app.

BlinkBot Core Behaviour:
{CORE}

Generate ONE realistic training example for this scenario:
SCENARIO: {category}

Output format — exactly this, no extra text:
USER_MESSAGE: [A realistic user message for this scenario. Make it feel natural — story-style, casual, or direct depending on category. Vary length: sometimes 3 words, sometimes 3 sentences.]
ASSISTANT_RESPONSE: [BlinkBot's full response starting with <think>...</think> then commands then RESPONSE:]

Rules for the example:
- USER_MESSAGE must feel like a real person typed or spoke it
- ASSISTANT_RESPONSE must have a complete <think> block, correct commands, and a short RESPONSE
- Commands must use the exact syntax from the core (TICK_HABIT: name, ADD_NOTE: content, etc.)
- RESPONSE must be 1-2 sentences maximum
- Match the user context provided: {ctx[:300]}
- If the scenario involves a duplicate, conflict, or edge case — handle it correctly per the core rules
- Do NOT generate conversational or chatbot-style responses"""

    raw = call_model(generator_prompt, f"Generate the training example now.", max_tokens=MAX_TOKENS)

    parts = raw.split("ASSISTANT_RESPONSE:")
    if "USER_MESSAGE:" in raw and len(parts) > 1:
        user_msg   = parts[0].replace("USER_MESSAGE:", "").strip()
        assist_msg = parts[1].strip()
    else:
        user_msg   = category
        assist_msg = raw.strip()

    return {
        "messages": [
            {"role": "system",    "content": CORE},
            {"role": "user",      "content": f"{ctx}\n\n{user_msg}"},
            {"role": "assistant", "content": assist_msg}
        ]
    }


# ── THREADED RUNNER ────────────────────────────────────────────────────────
def run():
    print(f"BLINKBOT AUTOMATOR DATASET — Target: {TARGET} | Workers: {MAX_WORKERS}")
    success = 0
    failed  = 0

    with open(OUTPUT_PATH, "w") as f:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {
                executor.submit(build_example, random.choice(SCENARIO_CATEGORIES)): i
                for i in range(TARGET)
            }

            for future in as_completed(futures):
                try:
                    example = future.result()
                    f.write(json.dumps(example) + "\n")
                    f.flush()
                    success += 1
                    if success % 50 == 0:
                        print(f"  Progress: {success}/{TARGET} ✓  (failed: {failed})")
                except Exception as e:
                    failed += 1
                    print(f"  Failed: {e}")
                    # Retry with a different scenario
                    futures[executor.submit(
                        build_example, random.choice(SCENARIO_CATEGORIES)
                    )] = TARGET + success

    print(f"\nDONE — {success} examples written to {OUTPUT_PATH}")
    print(f"Failed attempts: {failed}")
    print("TERMINATE THE GPU INSTANCE NOW.")


if __name__ == "__main__":
    run()
