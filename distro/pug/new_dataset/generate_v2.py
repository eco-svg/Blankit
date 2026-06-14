#!/usr/bin/env python3
"""
BlinkBot v2 dataset generator — CLEAN RESTART (2026-06-15).

BlinkBot is a TRANSLATOR, not a chatbot: user message -> ONE JSON command object.
Output per assistant turn = a short <think> line, then the JSON object:
    {"actions":[...], "needs_groq": bool, "reply": "..."}

Action types: tick_habit, log_note, log_achievement, log_metric,
              suggest_skill, undo, open_profile, logout.
needs_groq=true ONLY for personality/class analysis (rank is NOT a Groq call).
suggest_skill never auto-adds. Hedged progress -> log_note + ask once.

Reproducible (seeded). Writes blinkbot_v2.jsonl beside the legacy work.
"""
import json
import random

random.seed(42)

SYSTEM = (
    "You are BlinkBot, a translator. Turn the user's message into ONE JSON command "
    "object for the Veyra backend. You do not converse, explain, or chat. Output a "
    "brief <think> reasoning line, then the JSON. The JSON has keys: \"actions\" "
    "(a list of command objects), \"needs_groq\" (boolean, true ONLY when the user "
    "asks for personality/class analysis), and \"reply\" (a short confirmation, a "
    "few words when possible). Action types and their fields: "
    "tick_habit{name}, log_note{text}, log_achievement{title}, "
    "log_metric{skill,value}, suggest_skill{name}, undo{}, "
    "open_profile{target}, logout{}. Never auto-add a skill (suggest only). "
    "Hedged or partial progress is logged as a note, then ask once whether it counts."
)

# ----------------------------------------------------------------------------
# Pools
# ----------------------------------------------------------------------------
# habit name -> phrasings that mean "I did it" (clear, completed)
HABITS = {
    "running":      ["ran", "went for a run", "did my run", "got my run in", "knocked out my run"],
    "meditation":   ["meditated", "did my meditation", "sat for meditation", "got my meditation done"],
    "reading":      ["read", "did my reading", "read a chapter", "got some reading in"],
    "gym":          ["hit the gym", "did gym", "trained at the gym", "got my gym session in"],
    "journaling":   ["journaled", "did my journaling", "wrote in my journal"],
    "yoga":         ["did yoga", "got my yoga in", "finished yoga"],
    "stretching":   ["stretched", "did my stretching", "got my stretches in"],
    "walking":      ["went for a walk", "did my walk", "got my steps in"],
    "studying":     ["studied", "did my study session", "got my studying done"],
    "coding":       ["coded", "did my coding practice", "got a coding session in"],
    "water":        ["drank my water", "hit my water goal", "stayed hydrated"],
}

# casual variation suffixes to sprinkle on tick phrasings
TICK_TAILS = ["", " today", " this morning", " ✅", " finally", " like usual", " again"]

# metric skills -> (canonical skill name, value generator, phrasing builder)
def _run_time():
    return f"{random.randint(18, 52)}:{random.randint(0, 59):02d}"

def _swim_time():
    return f"{random.randint(0, 2)}:{random.randint(10, 59):02d}"

RUN_DIST = {"1k": "1 km Run", "2k": "2 km Run", "3k": "3 km Run",
            "5k": "5 km Run", "10k": "10 km Run"}

def metric_clause():
    # contract: (user_text, action, think_fragment, reply_word)
    kind = random.choice(["run", "run", "type", "chess", "swim", "sprint"])
    if kind == "run":
        d = random.choice(list(RUN_DIST))
        skill = RUN_DIST[d]
        km = int(d[:-1])
        total = int(km * random.uniform(4.0, 7.5) * 60)  # distance-realistic pace
        t = f"{total // 60}:{total % 60:02d}"
        d_var = random.choice([d, d.replace("k", " km"), d.replace("k", "km")])
        txt = random.choice([f"ran {d_var} in {t}", f"did my {d_var} in {t}",
                             f"{d_var} run, {t}", f"finished a {d_var} at {t}"])
        return txt, {"type": "log_metric", "skill": skill, "value": t}, "log run metric", f"logged {d}"
    if kind == "type":
        wpm = random.randint(45, 150)
        txt = random.choice([f"typed at {wpm} wpm", f"hit {wpm} wpm typing",
                             f"typing test came out {wpm} wpm"])
        return txt, {"type": "log_metric", "skill": "Typing", "value": f"{wpm} WPM"}, "log typing metric", "logged typing"
    if kind == "chess":
        elo = random.randint(700, 2300)
        plat = random.choice(["chess.com", "lichess"])
        txt = random.choice([f"hit {elo} on {plat}", f"my {plat} rating is {elo} now",
                             f"climbed to {elo} elo on {plat}"])
        return txt, {"type": "log_metric", "skill": "Chess", "value": f"{elo} ({plat})"}, "log chess metric", "logged chess"
    if kind == "swim":
        t = _swim_time()
        dist = random.choice(["50 m", "100 m", "200 m"])
        skill = f"{dist} Swimming"
        txt = random.choice([f"swam {dist} in {t}", f"{dist} swim at {t}"])
        return txt, {"type": "log_metric", "skill": skill, "value": t}, "log swim metric", "logged swim"
    # sprint
    secs = round(random.uniform(11.0, 18.0), 2)
    dist = random.choice(["100m", "200m", "400m"])
    skill = f"{dist} Sprint"
    txt = random.choice([f"ran the {dist} in {secs}s", f"{dist} sprint, {secs} seconds"])
    return txt, {"type": "log_metric", "skill": skill, "value": f"{secs}s"}, "log sprint metric", "logged sprint"

NOTES = [
    ("skipped lunch", "skipped lunch"),
    ("felt pretty tired all day", "felt tired"),
    ("only slept like 5 hours", "slept ~5 hours"),
    ("ate clean today", "ate clean"),
    ("had a stressful day at work", "stressful day"),
    ("design meeting went really well", "good design meeting"),
    ("forgot to drink water", "forgot water"),
    ("felt strong today", "felt strong"),
    ("woke up early", "woke up early"),
    ("had too much coffee", "too much coffee"),
    ("knee was acting up", "knee pain"),
    ("super productive afternoon", "productive afternoon"),
]

ACHIEVEMENTS = [
    ("got my first pull-up", "First pull-up"),
    ("hit a 30-day meditation streak", "30-day meditation streak"),
    ("finished my first 10k", "First 10k finished"),
    ("won my first chess tournament", "Won first chess tournament"),
    ("held a handstand for 30 seconds", "30s handstand"),
    ("read 50 books this year", "50 books in a year"),
    ("broke 100 wpm typing", "Broke 100 WPM"),
    ("ran a sub-25 5k", "Sub-25 5k"),
]

SUGGEST_SKILLS = [
    ("guitar", ["thinking of picking up guitar", "want to learn guitar",
                "been meaning to start guitar"]),
    ("piano", ["want to start learning piano", "thinking about piano lessons"]),
    ("chess", ["want to get serious about chess", "trying to get into chess"]),
    ("spanish", ["want to start learning spanish", "thinking of picking up spanish"]),
    ("photography", ["want to get into photography", "thinking about photography"]),
    ("pottery", ["been wanting to try pottery", "want to learn pottery"]),
    ("painting", ["want to start painting", "thinking of getting into painting"]),
    ("public speaking", ["want to get better at public speaking",
                         "trying to improve my public speaking"]),
]

NAMES = ["Aarav", "Priya", "Kenji", "Lena", "Mateo", "Chen", "Olga", "Sofia",
         "Ravi", "Yuki", "Amara", "Diego", "Nina", "Omar", "Hana", "Leo"]

HEDGES = ["kinda", "sort of", "almost", "more or less", "tried to", "barely", "halfway"]

# personality / class -> needs_groq, reply = localized "wait"
WAIT = {
    "english": "One sec…", "hindi": "रुकिए", "german": "Warte…",
    "japanese": "待って", "chinese": "等一下", "korean": "기다려요",
    "russian": "Подождите", "french": "Attendez…", "tamil": "காத்திருங்க",
    "marathi": "थांबा", "telugu": "ఆగండి",
}
PERSONALITY_EN = [
    "what kind of person am I?", "analyze my personality", "what's my class?",
    "sum me up based on my logs", "who am I, going by my data?",
    "give me my personality read",
]
PERSONALITY_OTHER = {
    "hindi": "मैं कैसा इंसान हूँ?", "german": "Was für ein Mensch bin ich?",
    "japanese": "私はどんな人間ですか？", "chinese": "我是什么样的人？",
    "korean": "나는 어떤 사람이야?", "russian": "Какой я человек?",
    "french": "Quel genre de personne suis-je ?", "tamil": "நான் எப்படிப்பட்ட நபர்?",
    "marathi": "मी कसा माणूस आहे?", "telugu": "నేను ఎలాంటి వ్యక్తిని?",
}

# ----------------------------------------------------------------------------
# Clause builders -> (user_text, action_obj_or_None, think_fragment, reply_word)
# ----------------------------------------------------------------------------
def tick_clause():
    h = random.choice(list(HABITS))
    txt = random.choice(HABITS[h]) + random.choice(TICK_TAILS)
    return txt, {"type": "tick_habit", "name": h}, f"tick {h}", f"ticked {h}"

def note_clause():
    txt, short = random.choice(NOTES)
    return txt, {"type": "log_note", "text": short}, "note", "noted"

def achievement_clause():
    txt, title = random.choice(ACHIEVEMENTS)
    return txt, {"type": "log_achievement", "title": title}, "achievement", "logged win"

def suggest_clause():
    name, phr = random.choice(SUGGEST_SKILLS)
    return random.choice(phr), {"type": "suggest_skill", "name": name}, f"suggest {name} (no auto-add)", f"suggested {name}"

def hedged_clause():
    h = random.choice(list(HABITS))
    verb = random.choice(HABITS[h]).split()[0]
    txt = f"{random.choice(HEDGES)} {verb} today"
    # hedged -> note, NOT a tick; reply asks once
    return txt, {"type": "log_note", "text": f"partial: {h}"}, f"hedged {h} -> note + ask", "__ASK__"

SINGLE_BUILDERS = [tick_clause, metric_clause, note_clause, achievement_clause]

# ----------------------------------------------------------------------------
def record(user_text, think, payload):
    assistant = f"<think>{think}</think>\n{json.dumps(payload, ensure_ascii=False)}"
    return {"messages": [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": user_text},
        {"role": "assistant", "content": assistant},
    ]}

CONNECTORS = [" and ", ", also ", " — then ", ", plus ", ". ", ", and "]

def build_reply(reply_words, asked):
    if asked:
        base = "; ".join(w for w in reply_words if w != "__ASK__")
        head = (base[:1].upper() + base[1:] + ". ") if base else ""
        return head + "Count that toward your progress?"
    # de-dup while preserving order
    seen, out = set(), []
    for w in reply_words:
        if w not in seen:
            out.append(w); seen.add(w)
    if len(out) == 1:
        return out[0][:1].upper() + out[0][1:] + "."
    return "Done — " + ", ".join(out) + "."

def make_compound():
    n = random.choice([2, 2, 3])
    builders = SINGLE_BUILDERS[:]
    clauses = []
    used_hedge = False
    for i in range(n):
        if not used_hedge and random.random() < 0.09:
            clauses.append(hedged_clause()); used_hedge = True
        else:
            clauses.append(random.choice(builders)())
    texts = [c[0] for c in clauses]
    user_text = texts[0]
    for t in texts[1:]:
        user_text += random.choice(CONNECTORS) + t
    actions = [c[1] for c in clauses]
    think = "; ".join(c[2] for c in clauses)
    asked = any(c[3] == "__ASK__" for c in clauses)
    reply = build_reply([c[3] for c in clauses], asked)
    return record(user_text, think, {"actions": actions, "needs_groq": False, "reply": reply})

def make_single_typed(kind):
    if kind == "tick":
        t, a, th, rw = tick_clause()
    elif kind == "metric":
        t, a, th, rw = metric_clause()
    elif kind == "note":
        t, a, th, rw = note_clause()
    elif kind == "achievement":
        t, a, th, rw = achievement_clause()
    elif kind == "suggest":
        t, a, th, rw = suggest_clause()
    elif kind == "hedged":
        t, a, th, rw = hedged_clause()
        return record(t, th, {"actions": [a], "needs_groq": False,
                              "reply": "Noted. Count that toward your progress?"})
    elif kind == "undo":
        t = random.choice(["undo", "undo that", "actually cancel that", "nvm, undo",
                           "wait undo the last one", "scratch that"])
        return record(t, "undo last action", {"actions": [{"type": "undo"}],
                                              "needs_groq": False, "reply": "Undone."})
    elif kind == "open_profile":
        name = random.choice(NAMES)
        t = random.choice([f"show me {name}'s profile", f"open {name}",
                           f"I wanna see {name}", f"pull up {name}'s profile",
                           f"get me {name}'s profile", f"who's {name}? show me"])
        return record(t, f"profile fetch -> {name}",
                      {"actions": [{"type": "open_profile", "target": name}],
                       "needs_groq": False, "reply": "Opening their profile."})
    elif kind == "logout":
        t = random.choice(["log me out", "logout", "sign me out", "log out please",
                           "log me out of veyra"])
        return record(t, "logout", {"actions": [{"type": "logout"}],
                                    "needs_groq": False, "reply": "Logging you out."})
    return record(t, th, {"actions": [a], "needs_groq": False,
                          "reply": rw[:1].upper() + rw[1:] + "."})

def make_personality(lang):
    if lang == "english":
        t = random.choice(PERSONALITY_EN)
    else:
        t = PERSONALITY_OTHER[lang]
    return record(t, "personality/class -> queue groq, say wait",
                  {"actions": [], "needs_groq": True, "reply": WAIT[lang]})

# ----------------------------------------------------------------------------
# Assemble ~1000 lines, >=500 compound
# ----------------------------------------------------------------------------
rows = []

# 570 compound
for _ in range(570):
    rows.append(make_compound())

# singles by type
singles_plan = {
    "tick": 65, "metric": 55, "note": 50, "achievement": 35,
    "suggest": 38, "undo": 28, "open_profile": 40, "logout": 24, "hedged": 30,
}
for kind, count in singles_plan.items():
    for _ in range(count):
        rows.append(make_single_typed(kind))

# needs_groq english (45) + one+ per other language (wait-word seed)
for _ in range(45):
    rows.append(make_personality("english"))
for lang in PERSONALITY_OTHER:
    for _ in range(2):
        rows.append(make_personality(lang))

random.shuffle(rows)

with open("blinkbot_v2.jsonl", "w", encoding="utf-8") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

print(f"wrote {len(rows)} rows")
