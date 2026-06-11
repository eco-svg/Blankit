/**
 * Health & Fitness Module
 * Tracks: Water intake, Sleep, Calories/Meals, Workouts, BMI
 */

const Health = {
    data: null,
    WATER_GOAL: 8,  // glasses

    init(habitData) {
        this.data = habitData;
        this.ensureHealthData();
        this.renderAll();
        this.attachEvents();
    },

    ensureHealthData() {
        const today = Utils.getCurrentDate();
        if (!this.data.health) this.data.health = {};

        // Reset daily data if it's a new day
        if (this.data.health.date !== today) {
            this.data.health = {
                date:     today,
                water:    0,
                sleep:    { bedtime: '', waketime: '', quality: 0, hours: 0 },
                calories: [],
                workouts: [],
                bmi:      this.data.health.bmi || { height: '', weight: '', value: null }
            };
            DataManager.saveData(this.data);
        }
    },

    attachEvents() {
        // ── Water ──────────────────────────────────────────────
        document.getElementById('addWaterBtn')?.addEventListener('click', () => {
            this.addWater(1);
        });
        document.getElementById('removeWaterBtn')?.addEventListener('click', () => {
            this.addWater(-1);
        });

        // ── Sleep ──────────────────────────────────────────────
        document.getElementById('saveSleepBtn')?.addEventListener('click', () => {
            this.saveSleep();
        });

        // ── Calories ───────────────────────────────────────────
        document.getElementById('addMealBtn')?.addEventListener('click', () => {
            this.addMeal();
        });
        document.getElementById('mealCalInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addMeal();
        });

        // ── Workout ────────────────────────────────────────────
        document.getElementById('addWorkoutBtn')?.addEventListener('click', () => {
            this.addWorkout();
        });
        document.getElementById('workoutRepsInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addWorkout();
        });

        // ── BMI ────────────────────────────────────────────────
        document.getElementById('calcBmiBtn')?.addEventListener('click', () => {
            this.calcBMI();
        });

        // ── Sleep quality stars ────────────────────────────────
        document.querySelectorAll('.sleep-star').forEach(star => {
            star.addEventListener('click', () => {
                const val = parseInt(star.dataset.val);
                this.data.health.sleep.quality = val;
                this.renderSleepStars(val);
                DataManager.saveData(this.data);
            });
        });
    },

    // ── Water ──────────────────────────────────────────────────────────────
    addWater(delta) {
        this.data.health.water = Math.max(0, Math.min(20, this.data.health.water + delta));
        this.renderWater();
        DataManager.saveData(this.data);

        if (this.data.health.water === this.WATER_GOAL && typeof Coach !== 'undefined') {
            Coach.addMessage('Coach', '💧 Water goal reached! Great hydration!');
        }
        if (typeof History !== 'undefined' && delta > 0) {
            History.addEntry(`Logged ${this.data.health.water} glasses of water`);
        }
    },

    renderWater() {
        const count   = this.data.health.water;
        const pct     = Math.min((count / this.WATER_GOAL) * 100, 100);
        const display = document.getElementById('waterCount');
        const bar     = document.getElementById('waterBar');
        const glasses = document.getElementById('waterGlasses');

        if (display) display.textContent = count;
        if (bar)     bar.style.width     = `${pct}%`;
        if (glasses) {
            glasses.innerHTML = '';
            for (let i = 0; i < this.WATER_GOAL; i++) {
                const g = document.createElement('span');
                g.textContent = i < count ? '🥤' : '🫙';
                g.style.fontSize = '1.3rem';
                glasses.appendChild(g);
            }
        }
    },

    // ── Sleep ──────────────────────────────────────────────────────────────
    saveSleep() {
        const bed  = document.getElementById('bedtimeInput')?.value;
        const wake = document.getElementById('waketimeInput')?.value;
        if (!bed || !wake) { alert('Please enter both bedtime and wake time!'); return; }

        const bedMins  = this.timeToMins(bed);
        const wakeMins = this.timeToMins(wake);
        let hours = (wakeMins - bedMins) / 60;
        if (hours < 0) hours += 24;

        this.data.health.sleep = {
            ...this.data.health.sleep,
            bedtime: bed, waketime: wake,
            hours: Math.round(hours * 10) / 10
        };

        this.renderSleep();
        DataManager.saveData(this.data);

        if (typeof History !== 'undefined') {
            History.addEntry(`Logged ${this.data.health.sleep.hours}h sleep`);
        }
        if (typeof Coach !== 'undefined') {
            const msg = hours >= 7
                ? `😴 ${hours}h sleep — well rested! Ready to crush it.`
                : `⚠️ Only ${hours}h sleep. Try to get 7-8h tonight.`;
            Coach.addMessage('Coach', msg);
        }
    },

    timeToMins(t) {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    },

    renderSleep() {
        const s = this.data.health.sleep;
        const hoursEl = document.getElementById('sleepHours');
        if (hoursEl) hoursEl.textContent = s.hours ? `${s.hours}h` : '--';

        const bedEl  = document.getElementById('bedtimeInput');
        const wakeEl = document.getElementById('waketimeInput');
        if (bedEl  && s.bedtime)  bedEl.value  = s.bedtime;
        if (wakeEl && s.waketime) wakeEl.value = s.waketime;

        this.renderSleepStars(s.quality);

        // Colour the hours by quality
        if (hoursEl) {
            if (s.hours >= 8)      hoursEl.style.color = 'var(--success)';
            else if (s.hours >= 6) hoursEl.style.color = 'var(--warning)';
            else if (s.hours > 0)  hoursEl.style.color = 'var(--fire)';
        }
    },

    renderSleepStars(quality) {
        document.querySelectorAll('.sleep-star').forEach(star => {
            star.textContent = parseInt(star.dataset.val) <= quality ? '⭐' : '☆';
        });
    },

    // ── Calories ───────────────────────────────────────────────────────────
    addMeal() {
        const nameEl = document.getElementById('mealNameInput');
        const calEl  = document.getElementById('mealCalInput');
        const name = nameEl?.value.trim();
        const cal  = parseInt(calEl?.value);

        if (!name || isNaN(cal) || cal <= 0) {
            alert('Please enter a meal name and valid calories!');
            return;
        }

        this.data.health.calories.push({
            id: Date.now(), name: Utils.sanitizeHTML(name), cal
        });

        if (nameEl) nameEl.value = '';
        if (calEl)  calEl.value  = '';

        this.renderCalories();
        DataManager.saveData(this.data);

        if (typeof History !== 'undefined') {
            History.addEntry(`Logged meal: ${name} (${cal} kcal)`);
        }
    },

    deleteMeal(id) {
        this.data.health.calories = this.data.health.calories.filter(m => m.id !== id);
        this.renderCalories();
        DataManager.saveData(this.data);
    },

    renderCalories() {
        const list  = document.getElementById('mealList');
        const total = document.getElementById('totalCalories');
        if (!list) return;

        const sum = this.data.health.calories.reduce((a, m) => a + m.cal, 0);
        if (total) total.textContent = sum;

        list.innerHTML = '';
        if (this.data.health.calories.length === 0) {
            list.innerHTML = '<div style="color:var(--text-dim);font-size:0.85rem;text-align:center;padding:8px">No meals logged yet</div>';
            return;
        }
        this.data.health.calories.forEach(meal => {
            const row = document.createElement('div');
            row.className = 'health-row';
            row.innerHTML = `
                <span>${meal.name}</span>
                <span style="color:var(--accent);font-weight:600">${meal.cal} kcal</span>
                <button onclick="Health.deleteMeal(${meal.id})"
                    style="padding:3px 8px;font-size:0.75rem;background:var(--fire)">✕</button>
            `;
            list.appendChild(row);
        });
    },

    // ── Workout ────────────────────────────────────────────────────────────
    addWorkout() {
        const exEl   = document.getElementById('workoutExInput');
        const setsEl = document.getElementById('workoutSetsInput');
        const repsEl = document.getElementById('workoutRepsInput');

        const ex   = exEl?.value.trim();
        const sets = parseInt(setsEl?.value);
        const reps = parseInt(repsEl?.value);

        if (!ex || isNaN(sets) || isNaN(reps) || sets <= 0 || reps <= 0) {
            alert('Please fill in exercise, sets and reps!');
            return;
        }

        this.data.health.workouts.push({
            id: Date.now(),
            exercise: Utils.sanitizeHTML(ex),
            sets, reps
        });

        if (exEl)   exEl.value   = '';
        if (setsEl) setsEl.value = '';
        if (repsEl) repsEl.value = '';

        this.renderWorkouts();
        DataManager.saveData(this.data);

        if (typeof History !== 'undefined') {
            History.addEntry(`Workout: ${ex} — ${sets}x${reps}`);
        }
        if (typeof Coach !== 'undefined' && this.data.health.workouts.length === 1) {
            Coach.addMessage('Coach', '💪 First workout logged! Keep grinding!');
        }
    },

    deleteWorkout(id) {
        this.data.health.workouts = this.data.health.workouts.filter(w => w.id !== id);
        this.renderWorkouts();
        DataManager.saveData(this.data);
    },

    renderWorkouts() {
        const list = document.getElementById('workoutList');
        if (!list) return;

        const totalEl = document.getElementById('totalWorkouts');
        if (totalEl) totalEl.textContent = this.data.health.workouts.length;

        list.innerHTML = '';
        if (this.data.health.workouts.length === 0) {
            list.innerHTML = '<div style="color:var(--text-dim);font-size:0.85rem;text-align:center;padding:8px">No workouts logged yet</div>';
            return;
        }
        this.data.health.workouts.forEach(w => {
            const row = document.createElement('div');
            row.className = 'health-row';
            row.innerHTML = `
                <span>${w.exercise}</span>
                <span style="color:var(--success);font-weight:600">${w.sets} × ${w.reps}</span>
                <button onclick="Health.deleteWorkout(${w.id})"
                    style="padding:3px 8px;font-size:0.75rem;background:var(--fire)">✕</button>
            `;
            list.appendChild(row);
        });
    },

    // ── BMI ────────────────────────────────────────────────────────────────
    calcBMI() {
        const hEl = document.getElementById('heightInput');
        const wEl = document.getElementById('weightInput');
        const h = parseFloat(hEl?.value);
        const w = parseFloat(wEl?.value);

        if (isNaN(h) || isNaN(w) || h <= 0 || w <= 0) {
            alert('Please enter valid height (cm) and weight (kg)!');
            return;
        }

        const hm  = h / 100;
        const bmi = Math.round((w / (hm * hm)) * 10) / 10;

        let category, color;
        if      (bmi < 18.5) { category = 'Underweight'; color = 'var(--accent)'; }
        else if (bmi < 25)   { category = 'Normal';      color = 'var(--success)'; }
        else if (bmi < 30)   { category = 'Overweight';  color = 'var(--warning)'; }
        else                 { category = 'Obese';        color = 'var(--fire)'; }

        this.data.health.bmi = { height: h, weight: w, value: bmi, category };
        this.renderBMI();
        DataManager.saveData(this.data);

        if (typeof History !== 'undefined') {
            History.addEntry(`BMI calculated: ${bmi} (${category})`);
        }
    },

    renderBMI() {
        const bmi = this.data.health.bmi;
        const valEl  = document.getElementById('bmiValue');
        const catEl  = document.getElementById('bmiCategory');
        const barEl  = document.getElementById('bmiBar');
        const hEl    = document.getElementById('heightInput');
        const wEl    = document.getElementById('weightInput');

        if (hEl && bmi.height) hEl.value = bmi.height;
        if (wEl && bmi.weight) wEl.value = bmi.weight;

        if (!bmi.value) return;

        if (valEl)  { valEl.textContent = bmi.value; }
        if (catEl)  {
            catEl.textContent = bmi.category;
            let color = 'var(--success)';
            if (bmi.category === 'Underweight') color = 'var(--accent)';
            if (bmi.category === 'Overweight')  color = 'var(--warning)';
            if (bmi.category === 'Obese')       color = 'var(--fire)';
            catEl.style.color = color;
        }
        // Bar: clamp BMI 10–40 → 0–100%
        if (barEl) {
            const pct = Math.min(Math.max(((bmi.value - 10) / 30) * 100, 0), 100);
            barEl.style.width = `${pct}%`;
        }
    },

    // ── Render all ─────────────────────────────────────────────────────────
    renderAll() {
        this.renderWater();
        this.renderSleep();
        this.renderCalories();
        this.renderWorkouts();
        this.renderBMI();
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Health;
}