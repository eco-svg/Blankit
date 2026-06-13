"""
distro/svg/routes/svg_route.py — svg's PAGE routes (the `svg` blueprint).

These just render HTML templates for logged-in Eco-Svg users; the actual data is fetched
by each page's JavaScript from the /api, /api/community, and /ai blueprints. Note: `/`
(login) is also the shared entry point that redirects an already-logged-in user to their
own distro's home.
"""
from flask import Blueprint, render_template, session, redirect, url_for
from functools import wraps

svg = Blueprint(
    'svg', __name__,
    static_folder='../static',
    static_url_path='/static/svg_style',
    template_folder='../templates',
)

# Where to send a logged-in user based on which distro their account belongs to.
DISTRO_REDIRECTS = {
    'Eco-Svg':   '/home',
    'CatalystCrew': '/d/home',
    'Ocellus':   '/pug/home',
}

def get_user():
    """Return the logged-in user's basic info from the session."""
    return {
        'username': session.get('username', ''),
        'distro':   session.get('distro', 'Eco-Svg'),
        'user_id':  session.get('user_id'),
    }

def login_required(f):
    """Decorator: only allow logged-in Eco-Svg users; everyone else is bounced to login."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('user_id'):
            return redirect(url_for('svg.login'))
        # Ecosvg-only pages — kick other distros back to login
        if session.get('distro') != 'Eco-Svg':
            return redirect(url_for('svg.login'))
        return f(*args, **kwargs)
    return decorated


@svg.route('/')
def login():
    """Shared login page. If already logged in, redirect to the user's own distro home."""
    if session.get('user_id') and session.get('username'):
        distro = session.get('distro', 'Eco-Svg')
        if distro in DISTRO_REDIRECTS:
            return redirect(DISTRO_REDIRECTS[distro])
        session.clear()  # stale session with old distro key — force re-login
    return render_template('shared/login.html')


# The routes below all follow the same pattern: require login, then render that feature's
# page template. The page's JavaScript loads the actual data from the API blueprints.
@svg.route('/home')
@login_required
def home():
    user = get_user()
    return render_template('svg/home.html', username=user['username'])


@svg.route('/settings')
@login_required
def settings():
    user = get_user()
    return render_template('svg/settings.html', username=user['username'])


@svg.route('/manifestation')
@login_required
def manifestation():
    user = get_user()
    return render_template('svg/manifestation.html', username=user['username'])


@svg.route('/history')
@login_required
def history():
    user = get_user()
    return render_template('svg/history.html', username=user['username'])


@svg.route('/achievements')
@login_required
def achievements():
    user = get_user()
    return render_template('svg/achievements.html', username=user['username'])


@svg.route('/achievements/top')
@login_required
def top_achievements():
    user = get_user()
    return render_template('svg/achievements.html', username=user['username'])


@svg.route('/calendar')
@login_required
def calendar():
    user = get_user()
    return render_template('svg/calendar.html', username=user['username'])


@svg.route('/community')
@login_required
def community():
    user = get_user()
    return render_template('svg/community.html', username=user['username'])


@svg.route('/support')
@login_required
def support():
    user = get_user()
    return render_template('svg/support.html', username=user['username'])