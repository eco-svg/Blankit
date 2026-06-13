"""
shared/extensions.py — shared Flask extension instances.

These are created once here (unconfigured) and imported everywhere, then bound to the
app inside create_app() via db.init_app(app) / limiter.init_app(app). Defining them in
their own module avoids circular imports between app.py and the route/model files.
"""
from flask_sqlalchemy import SQLAlchemy
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

db      = SQLAlchemy()  # the database handle — every model does `class X(db.Model)`
# Per-client rate limiter, keyed by IP. Routes can tighten with @limiter.limit(...); the
# default_limits below are a generous backstop so NO endpoint is ever fully unthrottled
# (high enough not to disturb the 2s feed/DM pollers; low enough to stop scripted abuse).
limiter = Limiter(key_func=get_remote_address, storage_uri="memory://",
                  default_limits=["600 per minute", "8000 per hour"])
