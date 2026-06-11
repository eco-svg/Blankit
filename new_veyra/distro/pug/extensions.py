import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

_raw_key = os.environ.get('VEYRA_KEY')
if not _raw_key:
    raise RuntimeError("VEYRA_KEY environment variable not set.")

_fernet = Fernet(_raw_key.encode())


def encrypt(text: str) -> str:
    return _fernet.encrypt(text.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet.decrypt(token.encode()).decode()
    except Exception:
        return ''
