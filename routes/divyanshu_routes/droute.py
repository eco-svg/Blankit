import os
from flask import Blueprint, render_template, session, redirect, url_for
from functools import wraps

BASE_DIR     = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../"))
TEMPLATE_DIR = os.path.join(BASE_DIR, "templates", "divyanhu_templates")

divyanshu_bp = Blueprint('divyanshu', __name__, template_folder=TEMPLATE_DIR)


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('user_id'):
            return redirect(url_for('svg.login'))
        if session.get('distro') != 'divyanhu':
            return redirect(url_for('svg.login'))
        return f(*args, **kwargs)
    return decorated


def get_user():
    return {
        'username': session.get('username', ''),
        'distro':   session.get('distro', 'divyanhu'),
        'user_id':  session.get('user_id'),
    }


@divyanshu_bp.route('/d/home')
@login_required
def home():
    user = get_user()
    return render_template('home.html', username=user['username'])


@divyanshu_bp.route('/d/habit-tracker')
@login_required
def habit_tracker():
    user = get_user()
    return render_template('home.html', username=user['username'])