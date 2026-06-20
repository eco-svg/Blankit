"""
app.py — the entry point for the whole Veyra platform.

Veyra hosts three independent "distros" (skins/products) on one Flask backend:
  • pug       (Ocellus)      — distro/pug/        — the main product we actively build
  • svg       (Eco-Svg)      — distro/svg/        — another team's distro
  • divyanshu (CatalystCrew) — distro/divyanshu/  — another team's distro
Shared code (auth, DB, config, common templates) lives in shared/.

What this file does, in order:
  1. A privacy-light site visit counter (page views + daily uniques, admins excluded).
  2. create_app() — the "application factory": builds the Flask app, loads config,
     connects the database/mail/rate-limiter, and registers every distro's routes.
  3. A set of idempotent startup migrations (_migrate_* / _sync_*) that patch the live
     database schema on boot — safe to run every time, they only apply changes once.
  4. The __main__ block that actually starts the web server.

The database is a remote Postgres (Supabase) even in local dev, so the migrations here
run against live data — that's why every one is wrapped in try/except and guarded by an
"is this change already applied?" check.
"""
import os
import hashlib
from datetime import date
from flask import Flask, session, render_template, request
from flask_mail import Mail
from werkzeug.middleware.proxy_fix import ProxyFix
from shared.config import Config
from shared.extensions import db
from distro.svg.services.badge_service import seed_badges
from shared.extensions import limiter

# ─────────────────────────────────────────────────────────────────────────────
# AI MODELS
# BlinkBot's on-device weights are streamed to the browser from B2 (set via
# BLINKBOT_MODEL_URL and served through /pug/install/blinkbot-model.gguf). The old
# startup Hugging Face download was removed — nothing in production used it, and the
# private HF repo / token are no longer needed.
# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# SITE VISIT COUNTER (privacy-light)
# Counts top-level HTML page loads as "views" and de-dupes daily "uniques" via a
# one-way, daily-rotating hash of IP+UA (the IP itself is never stored). Admin/owner
# traffic is excluded so the owner's own visits don't inflate the numbers. Surfaced
# in the pug admin panel (/pug/api/admin/visits).
# ─────────────────────────────────────────────────────────────────────────────
def _visitor_is_staff(uid):
    """True if the current visitor is an admin/owner (excluded from the counter)."""
    if not uid:
        return False
    try:
        from shared.auth.user import User
        u = db.session.get(User, uid)
        if u and getattr(u, 'is_admin', False):
            return True
        allow = (os.environ.get('PUG_ADMIN_EMAILS', '') + ',' +
                 os.environ.get('SVG_ADMIN_EMAILS', '')).lower()
        return bool(u and u.email and u.email.lower() in
                    {e.strip() for e in allow.split(',') if e.strip()})
    except Exception:
        return False


def _visitor_hash(req, secret, day):
    """One-way daily hash of the visitor. Combines the day + app secret so it rotates
    every day and can't be reversed to an IP/UA. The IP is used only to compute this
    hash, never persisted."""
    ip = (req.headers.get('X-Forwarded-For', req.remote_addr or '') or '').split(',')[0].strip()
    ua = req.headers.get('User-Agent', '')
    raw = f'{day.isoformat()}|{secret}|{ip}|{ua}'
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def _record_visit(req, secret):
    """Bump today's view count and record the visitor hash (insert-ignore for uniques)."""
    from distro.pug.routes.notes import SiteVisit, SiteVisitor
    today = date.today()
    sv = db.session.get(SiteVisit, today)
    if not sv:
        sv = SiteVisit(day=today, views=0)
        db.session.add(sv)
    sv.views = (sv.views or 0) + 1
    vhash = _visitor_hash(req, secret, today)
    if not db.session.get(SiteVisitor, (today, vhash)):
        db.session.add(SiteVisitor(day=today, vhash=vhash))
    db.session.commit()


# Each distro registers its URLs through a Flask "blueprint" (a bundle of routes).
# We import them here and attach them to the app inside create_app().
from distro.divyanshu.routes.droute import catalystcrew_bp
from distro.pug.routes.pug_route import pug_bp

mail = Mail()  # email sender (verification codes, password resets); configured in create_app()


# ─────────────────────────────────────────────────────────────────────────────
# DATABASE MIGRATIONS (run once per boot, safe to repeat)
# db.create_all() makes brand-new tables, but it never alters EXISTING tables.
# These functions handle everything create_all() can't: adding new columns,
# fixing foreign keys, renaming old values, re-aligning ID counters. Each step
# checks "is this already done?" first, so running them every startup is harmless.
# ─────────────────────────────────────────────────────────────────────────────
def _migrate_schema():
    """Add new tables/columns to the live DB that db.create_all() won't add on its own."""
    from sqlalchemy import inspect, text
    inspector = inspect(db.engine)

    # ── wallet tables ──
    tables = inspector.get_table_names()
    if 'wallets' not in tables:
        try:
            with db.engine.begin() as conn:
                conn.execute(text('''
                    CREATE TABLE wallets (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                        balance INTEGER NOT NULL DEFAULT 0,
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW()
                    )
                '''))
        except Exception as e:
            import warnings; warnings.warn(f'[migrate] wallets: {e}')
    if 'wallet_transactions' not in tables:
        try:
            with db.engine.begin() as conn:
                conn.execute(text('''
                    CREATE TABLE wallet_transactions (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        tx_type VARCHAR(30) NOT NULL,
                        amount INTEGER NOT NULL,
                        ref_id VARCHAR(100),
                        note VARCHAR(300),
                        status VARCHAR(20) NOT NULL DEFAULT \'pending\',
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                '''))
        except Exception as e:
            import warnings; warnings.warn(f'[migrate] wallet_transactions: {e}')
    if 'eye_rates' not in tables:
        try:
            with db.engine.begin() as conn:
                conn.execute(text('''
                    CREATE TABLE eye_rates (
                        currency  VARCHAR(10) PRIMARY KEY,
                        buy_rate  NUMERIC(18,8) NOT NULL,
                        sell_rate NUMERIC(18,8) NOT NULL,
                        min_topup INTEGER NOT NULL DEFAULT 20,
                        symbol    VARCHAR(10) DEFAULT \'\',
                        updated_at TIMESTAMP DEFAULT NOW()
                    )
                '''))
        except Exception as e:
            import warnings; warnings.warn(f'[migrate] eye_rates: {e}')

    # ── moderation columns on notes (post_reports / user_blocks tables come from create_all) ──
    if 'notes' in inspector.get_table_names():
        note_cols = {c['name'] for c in inspector.get_columns('notes')}
        for col, col_type in [('report_count', 'INTEGER DEFAULT 0'),
                              ('is_hidden',    'BOOLEAN DEFAULT FALSE'),
                              ('end_datetime', 'TIMESTAMP')]:
            if col not in note_cols:
                try:
                    with db.engine.begin() as conn:
                        conn.execute(text(f'ALTER TABLE notes ADD COLUMN {col} {col_type}'))
                except Exception as e:
                    import warnings; warnings.warn(f'[migrate] notes.{col}: {e}')

    # ── cross-distro community: mark which svg posts are shared to all distros ──
    if 'community_posts' in inspector.get_table_names():
        cp_cols = {c['name'] for c in inspector.get_columns('community_posts')}
        if 'is_global' not in cp_cols:
            try:
                with db.engine.begin() as conn:
                    conn.execute(text('ALTER TABLE community_posts ADD COLUMN is_global BOOLEAN DEFAULT FALSE'))
            except Exception as e:
                import warnings; warnings.warn(f'[migrate] community_posts.is_global: {e}')

    # ── user_badges migration ──
    if 'user_badges' in inspector.get_table_names():
        columns = {c['name'] for c in inspector.get_columns('user_badges')}
        if 'user_id' not in columns:
            try:
                with db.engine.begin() as conn:
                    conn.execute(text('ALTER TABLE user_badges ADD COLUMN user_id INTEGER REFERENCES users(id)'))
                    conn.execute(text('DELETE FROM user_badges WHERE user_id IS NULL'))
                try:
                    with db.engine.begin() as conn:
                        conn.execute(text('ALTER TABLE user_badges ALTER COLUMN user_id SET NOT NULL'))
                except Exception:
                    pass  # SQLite doesn't support this; PostgreSQL does
            except Exception as e:
                import warnings
                warnings.warn(f'[migrate] user_badges migration failed: {e}')

    # ── users new columns ──
    if 'users' in inspector.get_table_names():
        new_cols = [
            ('age',                  'INTEGER'),
            ('student_status',       "VARCHAR(20) DEFAULT 'none'"),
            ('student_school',       'VARCHAR(200)'),
            ('student_location',     'VARCHAR(200)'),
            ('student_grade',        'VARCHAR(50)'),
            ('student_submitted_at', 'TIMESTAMP'),
            ('student_id_url',       'VARCHAR(500)'),
            ('dob',                  'DATE'),
            ('last_seen',            'TIMESTAMP'),
            ('is_admin',             'BOOLEAN DEFAULT FALSE'),
            ('violation_count',      'INTEGER DEFAULT 0'),     # confirmed-report tally → mute escalation
            ('muted_until',          'TIMESTAMP'),             # can't post/comment/DM until this time
            ('public_search',        'BOOLEAN DEFAULT FALSE'), # 18+ opt-in: index my profile in search
        ]
        existing = {c['name'] for c in inspector.get_columns('users')}
        for col, col_type in new_cols:
            if col not in existing:
                try:
                    with db.engine.begin() as conn:
                        conn.execute(text(f'ALTER TABLE users ADD COLUMN {col} {col_type}'))
                except Exception as e:
                    import warnings
                    warnings.warn(f'[migrate] Could not add column {col}: {e}')

        # Grant admin to the designated admin account (idempotent)
        admin_username = os.environ.get('ADMIN_USERNAME', 'Admin-Pug')
        try:
            with db.engine.begin() as conn:
                conn.execute(text(
                    'UPDATE users SET is_admin = TRUE WHERE username = :u '
                    'AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin IS TRUE)'
                ), {'u': admin_username})
        except Exception as e:
            import warnings
            warnings.warn(f'[migrate] Could not grant admin flag: {e}')

    # ── verify_tokens: failed-attempt counter ──
    if 'verify_tokens' in inspector.get_table_names():
        vt_cols = {c['name'] for c in inspector.get_columns('verify_tokens')}
        if 'attempts' not in vt_cols:
            try:
                with db.engine.begin() as conn:
                    conn.execute(text('ALTER TABLE verify_tokens ADD COLUMN attempts INTEGER DEFAULT 0'))
            except Exception as e:
                import warnings
                warnings.warn(f'[migrate] verify_tokens.attempts: {e}')


def _migrate_fk_cascades():
    """Idempotent: add ON DELETE CASCADE to all FK constraints referencing users.id (and habits.id)."""
    from sqlalchemy import text
    if 'postgresql' not in str(db.engine.url):
        return
    try:
        with db.engine.begin() as conn:
            already = conn.execute(text("""
                SELECT COUNT(*) FROM information_schema.referential_constraints
                WHERE constraint_name = 'verify_tokens_user_id_fkey'
                AND delete_rule = 'CASCADE'
            """)).scalar()
            if already:
                return
            for table, constraint, col, ref_table in [
                ('verify_tokens', 'verify_tokens_user_id_fkey', 'user_id',  'users'),
                ('reset_tokens',  'reset_tokens_user_id_fkey',  'user_id',  'users'),
                ('habits',        'habits_user_id_fkey',         'user_id',  'users'),
                ('todos',         'todos_user_id_fkey',          'user_id',  'users'),
                ('user_badges',   'user_badges_user_id_fkey',    'user_id',  'users'),
                ('notes',         'notes_user_id_fkey',          'user_id',  'users'),
                ('habit_logs',    'habit_logs_habit_id_fkey',    'habit_id', 'habits'),
            ]:
                conn.execute(text(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {constraint}'))
                conn.execute(text(
                    f'ALTER TABLE {table} ADD CONSTRAINT {constraint} '
                    f'FOREIGN KEY ({col}) REFERENCES {ref_table}(id) ON DELETE CASCADE'
                ))
    except Exception as e:
        import warnings
        warnings.warn(f'[startup] FK cascade migration failed: {e}')


def _migrate_distro_names():
    """Rename old distro keys to new branded names (one-time, idempotent)."""
    from sqlalchemy import text
    mapping = {'ecosvg': 'Eco-Svg', 'ocellus': 'Ocellus', 'divyanhu': 'CatalystCrew'}
    try:
        with db.engine.begin() as conn:
            for old, new in mapping.items():
                conn.execute(text("UPDATE users SET distro = :new WHERE distro = :old"),
                             {'old': old, 'new': new})
    except Exception as e:
        import warnings
        warnings.warn(f'[startup] Distro name migration failed: {e}')


def _sync_sequences():
    """Re-align PostgreSQL serial sequences with actual max IDs to prevent UniqueViolation on insert."""
    from sqlalchemy import text
    if 'postgresql' not in str(db.engine.url):
        return
    tables = ['users', 'verify_tokens', 'reset_tokens']
    try:
        with db.engine.begin() as conn:
            for table in tables:
                conn.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                    f"GREATEST(COALESCE((SELECT MAX(id) FROM {table}), 1), 1))"
                ))
    except Exception as e:
        import warnings
        warnings.warn(f'[startup] Sequence sync failed: {e}')


# ─────────────────────────────────────────────────────────────────────────────
# APPLICATION FACTORY
# Builds and returns the configured Flask app: loads settings, connects the
# database / mail / rate-limiter, registers every distro's routes, installs
# security headers, and runs the startup migrations. Called once at boot.
# ─────────────────────────────────────────────────────────────────────────────
def create_app():
    app = Flask(
        __name__,
        template_folder='shared/templates',
        static_folder='shared/static',
    )
    app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

    # Config
    app.config.from_object(Config)
    secret = os.environ.get('SECRET_KEY')
    if not secret:
        is_prod = (os.environ.get('RENDER')  # set automatically on Render
                   or os.getenv('FLASK_ENV', 'development') != 'development')
        if is_prod:
            raise RuntimeError('SECRET_KEY must be set in production — refusing to start with a forgeable session key.')
        import warnings
        warnings.warn("SECRET_KEY not set — using insecure fallback (dev only).", stacklevel=2)
        secret = 'dev-only-change-in-prod'
    app.config['SECRET_KEY'] = secret
    db_url = os.environ.get('DATABASE_URL', 'sqlite:///veyra.db')
    if db_url.startswith('postgres://'):
        db_url = db_url.replace('postgres://', 'postgresql://', 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = db_url
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB upload cap

    db.init_app(app)
    mail.init_app(app)
    limiter.init_app(app)

    from distro.svg.routes.svg_route import svg
    from distro.svg.routes.api_route import api
    from distro.svg.routes.ai_route  import ai
    from shared.auth.auth_route import auth, init_mail
    from distro.svg.routes.community_route import community_api

    init_mail(mail)

    app.register_blueprint(svg)
    app.register_blueprint(api)
    app.register_blueprint(ai)
    app.register_blueprint(community_api)
    app.register_blueprint(auth)
    app.register_blueprint(catalystcrew_bp)
    app.register_blueprint(pug_bp)

    # ── Privacy-light visit counter ──
    # Count a "view" for each successful top-level HTML page load (the SPA loads its
    # shell once per visit, so this tracks visits, not in-app tab switches). Skips
    # assets/APIs and excludes admin/owner traffic. Best-effort: never break a page.
    @app.after_request
    def _track_visit(resp):
        try:
            if (request.method == 'GET'
                    and resp.status_code == 200
                    and 'text/html' in (resp.content_type or '')
                    and not request.path.startswith(('/static', '/sw.js', '/favicon'))
                    and '/static/' not in request.path
                    and not _visitor_is_staff(session.get('user_id'))):
                _record_visit(request, app.config.get('SECRET_KEY', ''))
        except Exception:
            db.session.rollback()
        return resp

    # ── PWA service worker (must be served from root scope) ──
    @app.route('/sw.js')
    def service_worker():
        from flask import send_from_directory
        resp = send_from_directory(app.static_folder, 'sw.js')
        resp.headers['Service-Worker-Allowed'] = '/'
        resp.headers['Cache-Control'] = 'no-cache'
        return resp

    @app.route('/favicon.ico')
    def favicon():
        from flask import send_from_directory
        return send_from_directory(
            os.path.join(app.static_folder, 'icons'),
            'icon-192.png',
            mimetype='image/png',
        )

    # ── CSP nonce: a fresh random token per request, used to allow ONLY our own inline
    #    <script> blocks (each tagged nonce="{{ csp_nonce }}"). Lets us drop 'unsafe-inline'
    #    from script-src so an injected <script> can't run. ──
    @app.before_request
    def _set_csp_nonce():
        import secrets
        from flask import g
        g.csp_nonce = secrets.token_urlsafe(16)

    @app.context_processor
    def _inject_csp_nonce():
        from flask import g
        return {'csp_nonce': getattr(g, 'csp_nonce', '')}

    # ── CSRF: block cross-site state-changing requests ──
    # On any mutating request, if the browser sent an Origin/Referer from a DIFFERENT host,
    # reject it. Same-origin requests (all of ours) pass; requests with no Origin (non-browser)
    # aren't blocked. This stops a malicious site from POST-ing to our API with the user's cookie.
    @app.before_request
    def csrf_origin_check():
        from flask import request as _req, jsonify
        if _req.method not in ('POST', 'PUT', 'PATCH', 'DELETE'):
            return
        from urllib.parse import urlparse
        source = _req.headers.get('Origin') or _req.headers.get('Referer')
        if source and urlparse(source).netloc != _req.host:
            return jsonify({'error': 'cross-origin request blocked'}), 403

    # ── Invalidate sessions for deleted users ──
    @app.before_request
    def validate_session_user():
        user_id = session.get('user_id')
        if not user_id:
            return
        from shared.auth.user import User
        if db.session.get(User, user_id):
            return
        session.clear()
        from flask import request as _req, redirect, url_for, jsonify
        if _req.path.startswith('/api/') or _req.headers.get('Accept', '').startswith('application/json'):
            return jsonify({'error': 'session_invalidated', 'message': 'Your account no longer exists.'}), 401
        return redirect(url_for('svg.login') + '?kicked=1')

    # ── Security response headers ──
    @app.after_request
    def security_headers(response):
        from flask import g
        nonce = getattr(g, 'csp_nonce', '')
        response.headers['X-Frame-Options']        = 'SAMEORIGIN'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy']        = 'strict-origin-when-cross-origin'
        # Force HTTPS for a year (Render is HTTPS-only) so no request can downgrade to http.
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        # Only allow the device features the app actually uses, and only from our own origin.
        response.headers['Permissions-Policy'] = (
            'geolocation=(self), camera=(self), microphone=(self), payment=(), usb=()'
        )
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; "
            f"script-src 'self' 'nonce-{nonce}' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: blob:; "
            "media-src 'self' blob:; "
            # BlinkBot on-device (wllama): fetch the WASM runtime from jsdelivr and the
            # GGUF from self or B2; blob: worker for llama.cpp's threads.
            "connect-src 'self' https://cdn.jsdelivr.net https://*.backblazeb2.com; "
            "worker-src 'self' blob:; "
            "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; "
            "frame-ancestors 'self' https://huggingface.co; "
            "object-src 'none'; "
            "base-uri 'self';"
        )

        # ── Cross-origin isolation → unlocks SharedArrayBuffer so BlinkBot's wllama
        #    runs MULTI-THREADED (much faster than single-thread WASM). Scoped to ONLY
        #    the pug home page (where the BlinkBot card lives) so cross-origin embeds
        #    on other pages (e.g. YouTube on community/posts) keep working. COEP
        #    `credentialless` keeps same-origin media + no-cors subresources loading
        #    without needing CORP headers on every third party. Browsers without
        #    credentialless (e.g. Safari) simply stay single-thread — graceful.
        from flask import request as _rq
        if _rq.endpoint == 'pug.home':
            response.headers['Cross-Origin-Opener-Policy']   = 'same-origin'
            response.headers['Cross-Origin-Embedder-Policy'] = 'credentialless'
        return response

    @app.route('/privacy')
    def privacy(): return render_template('shared/privacy.html')

    @app.route('/terms')
    def terms(): return render_template('shared/terms.html')

    @app.route('/under13')
    def under13(): return render_template('shared/under13.html')

    if (os.environ.get('MINIO_ACCESS_KEY', 'minioadmin') == 'minioadmin'
            and os.environ.get('FLASK_ENV') != 'development'):
        import warnings
        warnings.warn('MinIO is using default credentials in a non-dev environment!', stacklevel=2)

    with app.app_context():
        db.create_all()
        _migrate_schema()
        _migrate_fk_cascades()
        _migrate_distro_names()
        _sync_sequences()
        seed_badges()
        from distro.pug.routes.notes import refresh_eye_rates
        refresh_eye_rates()

    return app


if __name__ == '__main__':
    app = create_app()
    port = int(os.environ.get('PORT', 7860))
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(debug=debug, host='0.0.0.0', port=port, use_reloader=False)