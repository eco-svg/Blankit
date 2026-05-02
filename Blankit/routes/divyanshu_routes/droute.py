import os
from flask import Blueprint, render_template

# Get the absolute path to the 'Blankit' root folder
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../"))
# Point exactly to your uniquely named templates folder
TEMPLATE_DIR = os.path.join(BASE_DIR, "templates", "CatalystCrew_templates")

divyanshu_bp = Blueprint('divyanshu', __name__, template_folder=TEMPLATE_DIR)

@divyanshu_bp.route('/')
@divyanshu_bp.route('/home')
def home():
    return render_template('home.html')

@divyanshu_bp.route('/habit-tracker')
def habit_tracker():
    return render_template('home.html')