import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

# Use the shared db instance — do NOT create a new SQLAlchemy() here
from svg_models import db  # noqa: F401  (re-exported so notes.py can import from .extensions)

load_dotenv()

_raw_key = os.environ.get('BLANKIT_KEY')
if not _raw_key:
    raise RuntimeError("BLANKIT_KEY environment variable not set.")

fernet = Fernet(_raw_key.encode())


def encrypt(text: str) -> str:
    return fernet.encrypt(text.encode()).decode()


def decrypt(token: str) -> str:
    return fernet.decrypt(token.encode()).decode()