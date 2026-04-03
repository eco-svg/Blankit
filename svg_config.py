import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY          = os.getenv('SECRET_KEY', 'dev-fallback-key')
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', 'postgresql://localhost/blankit')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SESSION_COOKIE_HTTPONLY  = True
    SESSION_COOKIE_SAMESITE  = 'Lax'