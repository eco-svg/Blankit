"""
shared/config.py — central Flask configuration.

All settings are read from environment variables (loaded from a local .env file in
development). create_app() in app.py loads this class with app.config.from_object(Config).
Nothing here is hard-coded with secrets — they come from the environment.
"""
import os
from dotenv import load_dotenv
load_dotenv()  # read key=value pairs from a .env file into os.environ (dev convenience)

class Config:
    SECRET_KEY                  = os.getenv('SECRET_KEY')        # signs session cookies — must be set in prod
    SQLALCHEMY_DATABASE_URI     = os.getenv('DATABASE_URL')      # Postgres (Supabase) connection string
    SQLALCHEMY_DATABASE_URI     = os.getenv('DATABASE_URL')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    DISTRO                      = os.getenv('DISTRO', 'Eco-Svg')

    # Session cookie hardening — protects the login cookie against theft/misuse
    SESSION_COOKIE_HTTPONLY  = True          # JavaScript cannot read the cookie (blocks XSS theft)
    SESSION_COOKIE_SAMESITE  = 'Lax'         # cookie not sent on cross-site requests (CSRF mitigation)
    SESSION_COOKIE_SECURE    = os.getenv('FLASK_ENV', 'development') != 'development'  # HTTPS-only outside dev
    SESSION_COOKIE_NAME      = 'veyra_session'
    PERMANENT_SESSION_LIFETIME = 30 * 24 * 3600  # stay logged in for 30 days

    # Flask-Mail — outbound email (verification codes, password resets) via Gmail SMTP
    MAIL_SERVER                 = 'smtp.gmail.com'
    MAIL_PORT                   = 587
    MAIL_USE_TLS                = True
    MAIL_USERNAME               = os.getenv('MAIL_USERNAME')
    MAIL_PASSWORD               = os.getenv('MAIL_PASSWORD')
    MAIL_DEFAULT_SENDER         = ('VEYRA', os.getenv('MAIL_USERNAME'))