from flask import Blueprint, render_template

svg = Blueprint('svg', __name__)

USERNAME = 'eco-svg'   # hardcoded until login is added

@svg.route('/')
def home():
    return render_template('svg_templates/home.html', username=USERNAME)

@svg.route('/settings')
def settings():
    return render_template('svg_templates/settings.html', username=USERNAME)

@svg.route('/manifestation')
def manifestation():
    return render_template('svg_templates/manifestation.html', username=USERNAME)

@svg.route('/history')
def history():
    return render_template('svg_templates/history.html', username=USERNAME)

@svg.route('/achievements')
def achievements():
    return render_template('svg_templates/achievements.html', username=USERNAME)

@svg.route('/achievements/top')
def top_achievements():
    # same page, JS handles the section scroll
    return render_template('svg_templates/achievements.html', username=USERNAME)

@svg.route('/calendar')
def calendar():
    return render_template('svg_templates/calendar.html', username=USERNAME)