/**
 * Recurring Goals
 * Goals marked as recurring auto-reset completion at midnight every day.
 * A midnight check runs every minute; if the date has changed since last
 * reset, all recurring goals are unchecked and completedToday is adjusted.
 */

const Recurring = {
    data: null,
    checkInterval: null,

    init(habitData) {
        this.data = habitData;
        this.checkMidnightReset();
        this.startChecking();
        this.patchGoalsModule();
    },

    /**
     * Patch the Goals module so the goal element renders a ↻ toggle button.
     * Called after Goals.init() has already run.
     */
    patchGoalsModule() {
        // Wrap Goals.createGoalElement to append a recurring toggle
        const original = Goals.createGoalElement.bind(Goals);
        Goals.createGoalElement = (goal) => {
            const div = original(goal);

            const recurBtn = document.createElement('button');
            recurBtn.title   = goal.recurring ? 'Recurring (click to disable)' : 'Make recurring';
            recurBtn.textContent = '↻';
            recurBtn.style.cssText = `
                padding: 4px 8px;
                font-size: 0.85rem;
                background: ${goal.recurring ? 'var(--success)' : 'var(--border)'};
                color: ${goal.recurring ? 'white' : 'var(--text-dim)'};
                border-radius: 4px;
                margin-left: 2px;
                transition: all 0.2s;
            `;
            recurBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleRecurring(goal.id);
            });

            div.appendChild(recurBtn);
            return div;
        };

        // Re-render goals list so buttons appear
        Goals.render();
    },

    /**
     * Toggle a goal's recurring flag
     */
    toggleRecurring(goalId) {
        const goal = this.data.goals.find(g => g.id === goalId);
        if (!goal) return;

        goal.recurring = !goal.recurring;
        if (goal.recurring) {
            goal.lastResetDate = Utils.getCurrentDate();
            if (typeof History !== 'undefined') {
                History.addEntry(`Set "${goal.text}" as recurring`);
            }
        } else {
            if (typeof History !== 'undefined') {
                History.addEntry(`Removed recurring from "${goal.text}"`);
            }
        }

        Goals.render();
        DataManager.saveData(this.data);
    },

    /**
     * Check whether any recurring goals need to be reset.
     * Runs once on init and then every 60 seconds.
     */
    checkMidnightReset() {
        const today = Utils.getCurrentDate();
        let resetCount = 0;

        this.data.goals.forEach(goal => {
            if (!goal.recurring) return;
            if (!goal.lastResetDate) {
                goal.lastResetDate = today;
                return;
            }
            // Date has changed — reset completion
            if (goal.lastResetDate !== today && goal.completed) {
                goal.completed    = false;
                goal.completedAt  = null;
                goal.lastResetDate = today;
                if (this.data.completedToday > 0) this.data.completedToday--;
                resetCount++;
            } else if (goal.lastResetDate !== today) {
                goal.lastResetDate = today;
            }
        });

        if (resetCount > 0) {
            Goals.render();
            DataManager.updateMonthlyData(this.data);
            DataManager.saveData(this.data);

            if (typeof Coach !== 'undefined') {
                Coach.addMessage('Coach',
                    `🌅 New day! ${resetCount} recurring goal(s) have been reset. Let's go!`);
            }
            if (typeof History !== 'undefined') {
                History.addEntry(`Midnight reset: ${resetCount} recurring goal(s) cleared`);
            }
        }
    },

    startChecking() {
        this.checkInterval = setInterval(() => {
            this.checkMidnightReset();
        }, 60000);
    },

    destroy() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Recurring;
}