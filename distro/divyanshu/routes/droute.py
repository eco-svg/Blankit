import os
from flask import Blueprint, render_template, session, redirect, url_for
from functools import wraps

catalystcrew_bp = Blueprint(
    'catalystcrew', __name__,
    static_folder='../static',
    static_url_path='/static/catalystcrew_style',
    template_folder='../templates',
)


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('user_id'):
            return redirect(url_for('svg.login'))
        if session.get('distro') != 'CatalystCrew':
            return redirect(url_for('svg.login'))
        return f(*args, **kwargs)
    return decorated


def get_user():
    return {
        'username': session.get('username', ''),
        'distro':   session.get('distro', 'CatalystCrew'),
        'user_id':  session.get('user_id'),
    }


@catalystcrew_bp.route('/d/home')
@login_required
def home():
    user = get_user()
    return render_template('divyanshu/home.html', username=user['username'])


@catalystcrew_bp.route('/d/habit-tracker')
@login_required
def habit_tracker():
    user = get_user()
    return render_template('divyanshu/home.html', username=user['username'])