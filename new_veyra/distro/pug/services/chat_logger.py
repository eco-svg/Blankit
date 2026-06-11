import os
from datetime import datetime
from distro.pug.extensions import encrypt, decrypt

# Stored outside the project root so Flask's file watcher never triggers a reload
_LOGS_DIR = os.environ.get(
    'VEYRA_CHAT_LOGS',
    os.path.expanduser('~/.veyra_logs')
)


def _log_path(user_id):
    os.makedirs(_LOGS_DIR, exist_ok=True)
    return os.path.join(_LOGS_DIR, f'user_{user_id}.py')


def _day_header(dt):
    return f"_____{ dt.strftime('%A, %d %B %Y') }_____:"


def append_chat_entry(user_id, user_message, bot_response):
    now = datetime.now()
    path = _log_path(user_id)

    if os.path.exists(path):
        with open(path, 'r') as f:
            raw = f.read().strip()
        try:
            content = decrypt(raw)
        except Exception:
            content = ''
    else:
        content = ''

    today_header = _day_header(now)
    time_str = now.strftime('%H:%M')
    entry = f'[{time_str}] You: {user_message}\n[{time_str}] BlinkBot: {bot_response}'

    if today_header in content:
        content = content + '\n' + entry
    elif content:
        content = content + '\n\n' + today_header + '\n\n' + entry
    else:
        content = today_header + '\n\n' + entry

    with open(path, 'w') as f:
        f.write(encrypt(content))


def read_user_log(user_id):
    path = _log_path(user_id)
    if not os.path.exists(path):
        return None
    with open(path, 'r') as f:
        raw = f.read().strip()
    return decrypt(raw)
