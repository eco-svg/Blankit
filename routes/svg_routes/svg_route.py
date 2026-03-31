from flask import Flask, render_template
import os

app = Flask(__name__, 
            template_folder="/home/eco-svg/warehouse2/Blankit/templates",
            static_folder="/home/eco-svg/warehouse2/Blankit/static")

#routes
@app.route("/")
def test():
    return render_template("svg_templates/home.html",username="eco-svg")

@app.route("/settings")
def settings():
    return render_template("svg_templates/settings.html",username="eco-svg")

@app.route("/manifestation")
def manifestation():
    return render_template("svg_templates/manifestation.html", username="ecosvg")

@app.route("/history")
def history():
    return render_template("svg_templates/history.html", username="ecosvg")

@app.route("/achievements")
def achievements():
    return render_template("svg_templates/achievements.html", username="ecosvg")

@app.route("/achievements/top")
def top_achievements():
    return render_template("svg_templates/achievements",username="ecosvg")

if __name__ == "__main__":
    app.run(debug=True)