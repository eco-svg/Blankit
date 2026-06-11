"""
AI services: user-context assembly, chat-history search, Groq chat,
and character-sheet generation.

The ranking rules in the sheet prompt are product policy — ported verbatim
from the previous generation.
"""
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timedelta

from flask import current_app

from distro.pug.models import Note, unpack_achievement_body
from .chat_logger import read_user_log
from .bot_prompts import BLINKBOT_SYSTEM, BUDDYBOT_SYSTEM  # noqa: F401  (BLINKBOT re-exported)

GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'


def _groq_key():
    return os.environ.get('PUG_GROQ_API_KEY', '')


# ── User context ─────────────────────────────────────────────────────────────

def assemble_user_context(user_id, username):
    from shared.auth.user import User
    user = User.query.get(user_id)
    seven_days_ago = datetime.utcnow() - timedelta(days=7)

    recent_notes = Note.query.filter(
        Note.user_id == user_id,
        Note.entry_type == 'note',
        Note.is_deleted == False,
        Note.created_at >= seven_days_ago
    ).order_by(Note.created_at.desc()).limit(8).all()

    active_goals = Note.query.filter_by(
        user_id=user_id, entry_type='goal', is_deleted=False, is_finished=False
    ).order_by(Note.created_at.asc()).all()

    finished_this_week = Note.query.filter(
        Note.user_id == user_id,
        Note.entry_type == 'goal',
        Note.is_deleted == False,
        Note.is_finished == True,
        Note.updated_at >= seven_days_ago
    ).all()

    dream = Note.query.filter_by(
        user_id=user_id, entry_type='dream', is_deleted=False
    ).first()

    from distro.svg.models.habit import Habit
    from distro.svg.models.habit_log import HabitLog

    today      = datetime.utcnow().date()
    thirty_ago = today - timedelta(days=30)

    habits = Habit.query.filter_by(user_id=user_id, is_active=True).all()
    habit_summaries = []
    if habits:
        habit_ids = [h.id for h in habits]
        logs = HabitLog.query.filter(
            HabitLog.habit_id.in_(habit_ids),
            HabitLog.date >= thirty_ago
        ).all()
        logs_by_habit = defaultdict(dict)
        for lg in logs:
            logs_by_habit[lg.habit_id][lg.date] = lg.done
        for h in habits:
            ld     = logs_by_habit[h.id]
            done_7 = sum(1 for i in range(7) if ld.get(today - timedelta(days=i), False))
            streak = 0
            chk    = today
            while chk >= thirty_ago and ld.get(chk, False):
                streak += 1
                chk -= timedelta(days=1)
            habit_summaries.append({
                'name':       h.name,
                'done_today': bool(ld.get(today, False)),
                'done_7':     done_7,
                'streak':     streak,
            })

    return {
        'username':           username,
        'member_since':       user.created_at.strftime('%Y-%m-%d') if user and user.created_at else 'unknown',
        'dream':              dream.title if dream else None,
        'active_goals':       [g.title for g in active_goals],
        'finished_this_week': [g.title for g in finished_this_week],
        'recent_notes':       [
            {
                'title':   n.title or '(untitled)',
                'excerpt': (n.body[:200] + '...') if len(n.body) > 200 else n.body,
                'date':    n.created_at.strftime('%Y-%m-%d')
            }
            for n in recent_notes
        ],
        'habits': habit_summaries,
    }


def build_context_block(ctx):
    lines = [
        '',
        '────────────────────────────────────────',
        'INJECTED USER CONTEXT (PRE-FETCHED)',
        '────────────────────────────────────────',
        f'Username     : {ctx["username"]}',
        f'Member since : {ctx["member_since"]}',
        f'Locked Dream : {ctx["dream"] or "Not set yet"}',
        '',
        'Active Goals:',
    ]
    for g in ctx['active_goals'] or ['  None']:
        lines.append(f'  - {g}')
    lines += ['', 'Completed Goals (last 7 days):']
    for g in ctx['finished_this_week'] or ['  None']:
        lines.append(f'  - {g}')
    lines += ['', 'Recent Notes (last 7 days):']
    if ctx['recent_notes']:
        for n in ctx['recent_notes']:
            lines.append(f'  [{n["date"]}] {n["title"]}: {n["excerpt"]}')
    else:
        lines.append('  None')
    lines += ['', 'Habits (active):']
    if ctx.get('habits'):
        for h in ctx['habits']:
            tick = '✓' if h['done_today'] else '✗'
            lines.append(f"  {tick} {h['name']}: {h['done_7']}/7 this week, streak {h['streak']}d")
    else:
        lines.append('  None tracked yet')
    lines += [
        '',
        '────────────────────────────────────────',
        'EXECUTION NOTE',
        '────────────────────────────────────────',
        'fetch_user_profile, fetch_dashboard_data, fetch_memory_recent have been',
        'pre-executed and injected above. Skip those tool calls.',
        'Handle light tasks directly.',
        'Route complex reasoning to BuddyBot via the route_to_server tool call.',
    ]
    return '\n'.join(lines)


# ── Persistent chat-log search ───────────────────────────────────────────────

_STOP_WORDS = {
    'the', 'a', 'an', 'is', 'it', 'to', 'of', 'and', 'or', 'in', 'on', 'at',
    'i', 'my', 'me', 'you', 'we', 'do', 'did', 'was', 'are', 'have', 'has',
    'be', 'this', 'that', 'what', 'how', 'why', 'who', 'when', 'where',
    'can', 'will', 'would', 'should', 'could', 'just', 'really', 'very',
}


def parse_chat_log(log_text):
    """Parse decrypted chat log into a list of {date, user, bot} dicts."""
    exchanges = []
    current_date = ''
    pending_user = None
    for line in log_text.split('\n'):
        line = line.rstrip()
        if line.startswith('_____') and line.endswith('_____:'):
            current_date = line.strip('_:').strip()
        elif '] You: ' in line:
            pending_user = line.split('] You: ', 1)[-1]
        elif '] BlinkBot: ' in line and pending_user is not None:
            bot_msg = line.split('] BlinkBot: ', 1)[-1]
            exchanges.append({'date': current_date, 'user': pending_user, 'bot': bot_msg})
            pending_user = None
    return exchanges


def search_chat_history(user_id, query, max_results=6):
    log = read_user_log(user_id)
    if not log:
        return []
    exchanges = parse_chat_log(log)
    if not exchanges:
        return []
    query_words = set(query.lower().split()) - _STOP_WORDS
    if not query_words:
        return []
    scored = []
    for ex in exchanges:
        combined = (ex['user'] + ' ' + ex['bot']).lower()
        score = sum(1 for w in query_words if w in combined)
        if score > 0:
            scored.append((score, ex))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [ex for _, ex in scored[:max_results]]


def format_memory_block(exchanges):
    if not exchanges:
        return ''
    lines = ['RELEVANT PAST CONVERSATIONS (from memory):']
    for ex in exchanges:
        lines.append(f"[{ex['date']}] You: {ex['user']}")
        lines.append(f"              BlinkBot: {ex['bot']}")
    return '\n'.join(lines)


# ── Groq calls ───────────────────────────────────────────────────────────────

def groq_answer(query, system='You are a concise knowledge assistant. Answer questions clearly and briefly.',
                model='llama-3.1-8b-instant', max_tokens=512, timeout=15):
    """One-shot Groq completion. Returns text or None."""
    import requests as req
    api_key = _groq_key()
    if not api_key:
        return None
    try:
        r = req.post(
            GROQ_URL,
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={
                'model': model,
                'messages': [
                    {'role': 'system', 'content': system},
                    {'role': 'user',   'content': query},
                ],
                'max_tokens': max_tokens,
            },
            timeout=timeout,
        )
        if r.ok:
            return r.json()['choices'][0]['message']['content']
        current_app.logger.error(f'Groq {r.status_code}: {r.text[:200]}')
    except Exception as e:
        current_app.logger.error(f'Groq error: {e}')
    return None


# ── Character sheet ──────────────────────────────────────────────────────────

def _sheet_prompt(user_id, user_context, notes_count, streak):
    all_finished = Note.query.filter_by(
        user_id=user_id, entry_type='goal', is_deleted=False, is_finished=True
    ).order_by(Note.updated_at.desc()).limit(30).all()
    finished_str = ', '.join(g.title for g in all_finished) or 'none'

    all_work = Note.query.filter_by(
        user_id=user_id, entry_type='achievement', is_deleted=False
    ).order_by(Note.created_at.desc()).limit(20).all()
    work_items = []
    for w in all_work:
        a = unpack_achievement_body(w.body)
        entry = w.title
        if a['desc']:
            entry += f" ({a['desc']})"
        if a['verify_status'] == 'link':
            entry += f" [VERIFIED via link: {a['verify_link']}]"
        elif a['verify_status'] in ('media', 'pending'):
            entry += ' [VERIFIED: media/screenshot uploaded as evidence]'
        elif a['proof']:
            entry += f" [proof: {a['proof']}]"
        work_items.append(entry)
    work_str = ', '.join(work_items) or 'none'

    goals_str = ', '.join(user_context['active_goals'][:10]) or 'none'
    notes_str = ', '.join(n['title'] for n in user_context['recent_notes'][:10]) or 'none'

    _LIFESTYLE_KWS = ('sleep', 'water', 'wake', 'woke', 'bed', 'morning', 'routine',
                      'meditat', 'posture', 'journal', 'phone', 'drink', 'breathe',
                      'shower', 'step count', 'stretch', 'vitamins', 'supplements')
    skill_habits = [
        h['name'] for h in (user_context.get('habits') or [])
        if not any(kw in h['name'].lower() for kw in _LIFESTYLE_KWS)
    ]
    habit_skills_str = ', '.join(skill_habits[:15]) or 'none'

    log       = read_user_log(user_id) or ''
    exchanges = parse_chat_log(log) if log else []
    history_lines = [
        f"[{ex['date']}] You: {ex['user'][:80]} | BlinkBot: {ex['bot'][:80]}"
        for ex in exchanges
    ]
    if len(history_lines) > 40:
        history_lines = history_lines[:10] + ['...'] + history_lines[-30:]
    chat_summary = '\n'.join(history_lines) if history_lines else 'No chat history yet.'

    return (
        "Generate a character sheet for this person. Follow the rules exactly.\n\n"
        f"Dream: {user_context['dream'] or 'not set'}\n"
        f"Finished Goals: {finished_str}\n"
        f"Work / Shipped Projects (strongest evidence): {work_str}\n"
        f"Active Goals (aspirations only, do NOT use for ranking): {goals_str}\n"
        f"Active Skill Habits (ongoing practice — E-rank evidence): {habit_skills_str}\n"
        f"Notes Written: {notes_str}\n"
        f"Member Since: {user_context['member_since']}\n"
        f"Total Notes: {notes_count}, Streak: {streak} days\n\n"
        f"Conversation History:\n{chat_summary}\n\n"
        "STRICT RULES:\n"
        "1. CLASS is determined ONLY by Work/shipped projects + finished goals + top skills. "
        "   Active/planned goals do NOT count. No real output = class is 'Blank Slate'. "
        "   Use real-world role names (e.g. 'Runner', 'Writer', 'Developer'), NOT game titles.\n"
        "2. PERSONALITY is inferred from chat patterns, written goals, notes, behavior — "
        "   who they seem to be, what drives them. Short archetype name + one sentence.\n"
        "3. SKILLS come from: (a) Achievements/shipped projects — strongest signal; "
        "   (b) Finished goals — strong signal; "
        "   (c) Active Skill Habits — weakest signal, gives rank E only (unverified). "
        "   A habit like 'Run 5km', 'Practice guitar', 'Study Japanese' = E-rank skill evidence. "
        "   Never infer skills from active goals (goals are aspirations, habits are practice). "
        "   Return only skills with any evidence — 0 to 5 max. "
        "   Use plain words: 'Cooking' not 'Culinary Arts', 'Running' not 'Physical Fitness'. "
        "   LIFESTYLE / HABIT FILTER — CRITICAL: Completely ignore any entry that is a daily habit, "
        "   routine, or lifestyle behaviour — examples: 'woke up early', 'slept 8 hours', 'drank water', "
        "   'went to bed on time', 'morning routine', 'walked to work', 'meditated', 'no phone before bed'. "
        "   These are not skills and have no competitive benchmark — do NOT generate a skill row for them. "
        "   A bare 'Ran Xkm' with no time, pace, or Strava proof is also lifestyle — treat it as unverified Running at rank E.\n"
        "   SOFTWARE/TECH SKILLS — TWO-PHASE RULE:\n"
        "   Phase 1 (UNVERIFIED): If a software achievement has NO '[VERIFIED...]' tag, you CANNOT know "
        "   what was actually built, the tech stack, or the quality. Use skill name 'Software Development' "
        "   as a placeholder and rank it E. Do NOT guess B+ from the project name alone — "
        "   'Veyra SaaS' or any project name tells you nothing about frontend/backend/full-stack split, "
        "   code quality, or deployment status without proof. Note MUST ask for a GitHub link or "
        "   live URL so the next scan can determine the specific type and real rank.\n"
        "   Phase 2 (VERIFIED): Once '[VERIFIED via link: ...]' or '[VERIFIED: media...]' exists, "
        "   infer the specific type from the evidence — both UI and API/server code = 'Full-Stack Development'; "
        "   purely client-side = 'Frontend Development'; API/server/DB only = 'Backend Development'; "
        "   mobile app = 'iOS/Android Development'; ML model or pipeline = 'Machine Learning'; etc. "
        "   Do NOT use 'Software Development' once verified — be specific.\n"
        "   OVERRIDE RULE — VERIFIED EVIDENCE: Any achievement tagged '[VERIFIED: media/screenshot uploaded as evidence]' "
        "   or '[VERIFIED via link: ...]' means the user HAS ALREADY submitted proof. "
        "   You MUST set 'verified': true for the skill matching that achievement. This is unconditional — do not override it. "
        "   If the evidence references running (Strava/NRC screenshot, run data), rank it as Running. "
        "   If the evidence is a GitHub repo/link, rank it as the relevant code skill. Etc.\n"
        "   VERIFIED field: set 'verified': true ONLY if there is a '[VERIFIED...]' tag OR a concrete, "
        "   independently checkable metric (a finishing time, a Strava export, a public GitHub link). "
        "   A bare achievement title with no tag and no metric = verified: false. "
        "   Unverified skills will show '?' rank to the user until they submit evidence.\n"
        "   Leave the 'note' field empty — notes are handled automatically by the app.\n"
        "4. RANKING — CRITICAL RULE: rank ONLY relative to people who actively practise that skill. "
        "   Never compare against the general public — most people never run, code, cook, etc. "
        "   Use real-world census/stats data for each field to calibrate benchmarks. "
        "   'Among the people who do this, where does this person stand?'\n"
        "   S+ = Beyond any known record in the field\n"
        "   S  = Top 0.001% of active practitioners (absolute world-class)\n"
        "   S- = Top 0.01–0.1% of active practitioners (national/international competitor level)\n"
        "   A+ = Top 1% of active practitioners\n"
        "   A  = Top 1–5% of active practitioners\n"
        "   A- = Top 5–10% of active practitioners\n"
        "   B+ = Top 10–20% of active practitioners\n"
        "   B  = Top 20–30% of active practitioners\n"
        "   B- = Top 30–40% of active practitioners\n"
        "   C+ = Top 40–50% of active practitioners\n"
        "   C  = Top 50–60% of active practitioners (median)\n"
        "   C- = Top 60–70% of active practitioners\n"
        "   D+ = Top 70–80% of active practitioners\n"
        "   D  = Top 80–90% of active practitioners\n"
        "   D- = Top 90–99% of active practitioners (bottom tier, but still practising)\n"
        "   E+ = Active beginner — regular practice, several months in, no metrics yet\n"
        "   E  = Beginner — started recently, a handful of sessions\n"
        "   E- = Very first steps — one or two tries, just discovered the skill\n"
        "   F  = General public — has not started this skill at all\n"
        "   CALIBRATION EXAMPLES:\n"
        "   Running (global ~800M recreational runners): average 5K ~27 min. Sub-17 = S-. Sub-20 = A+. Sub-24 = B. Sub-30 = C. Just started = E.\n"
        "   Software Dev (~27M professional devs worldwide — ONLY applies to VERIFIED achievements): "
        "   verified live deployment + clean code = B+. Verified active open-source contributor = A. "
        "   Verified side project, no live product = B-. Unverified claim of any project = E (placeholder). "
        "   Never rank above E without a '[VERIFIED...]' tag or independently checkable proof.\n"
        "   Cooking (~1B regular home cooks): makes complex multi-course meals = A-. Reliable weekday cooking = C+. Just started = E.\n"
        "   If you cannot determine rank from available data, use E and add a note asking "
        "   for the data needed.\n"
        "   DO NOT give high ranks because a goal sounds ambitious. Only evidence counts.\n"
        "5. CONTEXT — only for VERIFIED skills (verified: true). "
        "   One line anchoring the rank in real-world terms — answers 'compared to what?'. "
        "   For measurable skills (running, lifting, chess, swimming): use the actual metric from the evidence. "
        "   For skills without hard global data (cooking, writing, creativity): describe the landscape honestly, end with '(estimated)'. "
        "   Never invent a percentage or metric that isn't in the evidence. "
        "   Keep it under 15 words. No rank letter — the badge already shows that. "
        "   For unverified skills, set context to empty string.\n"
        "6. CLASS DETECTION — extract the specific sub-class from the evidence text when possible.\n"
        "   Running classes: 1km, 2km, 3km, 4km, 5km, 10km, 15km, 20km, half_marathon, marathon, 25km, 50km, 75km, 100km.\n"
        "   'run 5km', 'ran 5k', '5km run', 'Couch to 5k' → class_id: '5km', class_label: '5 km'.\n"
        "   'run 10km' → class_id: '10km', class_label: '10 km'. 'marathon training' → class_id: 'marathon', class_label: 'Marathon (42.2 km)'.\n"
        "   Powerlifting/Weightlifting → detect lift: squat, bench, deadlift, snatch, clean_jerk, or pl_total.\n"
        "   Chess → class_id: 'elo', class_label: 'ELO Rating'.\n"
        "   Language skills → use the exam/language code: cefr, jlpt, hsk, goethe.\n"
        "   If no specific class can be determined, leave class_id and class_label as empty strings.\n"
        "7. Simple English throughout. Common words only.\n\n"
        "Output ONLY valid JSON:\n"
        '{"class_official":"role based on achievements (Blank Slate if none)",'
        '"class_playful":"same role with flair",'
        '"personality":"2-4 word archetype",'
        '"personality_desc":"One sentence about their mindset.",'
        '"bio":"One sentence. Who they actually are right now.",'
        '"skills":['
        '{"name":"plain skill name","rank":"E","verified":false,"context":"","note":"","class_id":"5km","class_label":"5 km"}'
        ']}'
    )


def _parse_json_blob(raw):
    match = re.search(r'\{.*\}', raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return None


_TECH_KEYWORDS = ('development', 'engineering', 'programming', 'coding', 'software',
                  'frontend', 'backend', 'fullstack', 'full-stack', 'devops',
                  'machine learning', 'ml', 'ios', 'android', 'web dev')
_RUN_KEYWORDS  = ('running', 'run', 'marathon', '5k', '10k', 'sprint', 'jogging')
_LIFT_KEYWORDS = ('strength', 'powerlifting', 'weightlifting', 'lifting', 'squat', 'bench', 'deadlift', 'gym')
_COOK_KEYWORDS = ('cooking', 'culinary', 'baking', 'chef', 'cuisine')

_NOTES = {
    'tech':    'Verify with a GitHub link or live URL — it reveals your stack and unlocks a real rank.',
    'running': 'Add a result with a time or pace and verify with a Strava screenshot.',
    'lifting': 'Log a max lift (squat / bench / deadlift in kg) and verify with a video.',
    'cooking': 'Add a dish you cook regularly and verify with a photo or video.',
    'default': 'Add specific results or proof in Achievements to unlock a real rank.',
}


def _enforce_rules(sheet):
    """Post-process: unverified = rank E, no context, standardised note; preserve class fields."""
    if not sheet or 'skills' not in sheet:
        return sheet
    for s in sheet['skills']:
        s.setdefault('class_id', '')
        s.setdefault('class_label', '')
        if s.get('verified') is False:
            s['rank']    = 'E'
            s['context'] = ''
            name_lower = (s.get('name') or '').lower()
            if any(kw in name_lower for kw in _TECH_KEYWORDS):
                s['name'] = 'Software Development'
                s['note'] = _NOTES['tech']
            elif any(kw in name_lower for kw in _RUN_KEYWORDS):
                s['note'] = _NOTES['running']
            elif any(kw in name_lower for kw in _LIFT_KEYWORDS):
                s['note'] = _NOTES['lifting']
            elif any(kw in name_lower for kw in _COOK_KEYWORDS):
                s['note'] = _NOTES['cooking']
            else:
                s['note'] = _NOTES['default']
    return sheet


def generate_character_sheet(user_id, user_context, notes_count, streak):
    """Generate via Groq. Returns sheet dict or None."""
    import requests as req
    prompt  = _sheet_prompt(user_id, user_context, notes_count, streak)
    api_key = _groq_key()
    if not api_key:
        return None
    try:
        r = req.post(
            GROQ_URL,
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={
                'model':       'llama-3.3-70b-versatile',
                'messages':    [{'role': 'user', 'content': prompt}],
                'max_tokens':  400,
                'temperature': 0.8,
            },
            timeout=20,
        )
        if r.ok:
            return _enforce_rules(_parse_json_blob(r.json()['choices'][0]['message']['content'].strip()))
        current_app.logger.error(f'Groq character sheet {r.status_code}: {r.text[:200]}')
    except Exception as e:
        current_app.logger.error(f'Groq character sheet error: {e}')
    return None
