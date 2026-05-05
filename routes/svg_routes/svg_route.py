from flask import Blueprint, render_template, session, redirect, url_for
from functools import wraps

svg = Blueprint('svg', __name__)

DISTRO_REDIRECTS = {
    'ecosvg':   '/home',
    'divyanhu': '/d/home',
    'thepug':   '/pug/home',
}

def get_user():
    return {
        'username': session.get('username', ''),
        'distro':   session.get('distro', 'ecosvg'),
        'user_id':  session.get('user_id'),
    }

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('user_id'):
            return redirect(url_for('svg.login'))
        # Ecosvg-only pages — kick other distros back to login
        if session.get('distro') != 'ecosvg':
            return redirect(url_for('svg.login'))
        return f(*args, **kwargs)
    return decorated


@svg.route('/')
def login():
    if session.get('user_id') and session.get('username'):
        distro = session.get('distro', 'ecosvg')
        return redirect(DISTRO_REDIRECTS.get(distro, '/home'))
    session.clear()
    return render_template('shared/login.html')


@svg.route('/home')
@login_required
def home():
    user = get_user()
    return render_template('svg_templates/home.html', username=user['username'])


@svg.route('/settings')
@login_required
def settings():
    user = get_user()
    return render_template('svg_templates/settings.html', username=user['username'])


@svg.route('/manifestation')
@login_required
def manifestation():
    user = get_user()
    return render_template('svg_templates/manifestation.html', username=user['username'])


@svg.route('/history')
@login_required
def history():
    user = get_user()
    return render_template('svg_templates/history.html', username=user['username'])


@svg.route('/achievements')
@login_required
def achievements():
    user = get_user()
    return render_template('svg_templates/achievements.html', username=user['username'])


@svg.route('/achievements/top')
@login_required
def top_achievements():
    user = get_user()
    return render_template('svg_templates/achievements.html', username=user['username'])


@svg.route('/calendar')
@login_required
def calendar():
    user = get_user()
    return render_template('svg_templates/calendar.html', username=user['username'])


@svg.route('/community')
@login_required
def community():
    user = get_user()
    return render_template('svg_templates/community.html', username=user['username'])


@svg.route('/support')
@login_required
def support():
    user = get_user()
    return render_template('svg_templates/support.html', username=user['username'])