/**
 * Step Tracker
 * Manages step counting and kilometer conversion
 */

const Steps = {
    elements: {},
    data: null,
    GOAL_STEPS: 10000,

    /**
     * Initialize step tracker
     */
    init(habitData) {
        this.data = habitData;
        this.cacheElements();
        this.attachEvents();
        this.updateUI();
    },

    /**
     * Cache DOM elements
     */
    cacheElements() {
        this.elements = {
            stepCount: document.getElementById('stepCount'),
            kmDisplay: document.getElementById('kmDisplay'),
            progressBar: document.getElementById('stepProgressBar'),
            goalText: document.getElementById('stepGoalText'),
            input: document.getElementById('stepInput'),
            updateBtn: document.getElementById('updateStepsBtn')
        };

        // Verify elements exist
        if (!this.elements.updateBtn) {
            console.error('Update button not found!');
        }
    },

    /**
     * Attach event listeners
     */
    attachEvents() {
        if (this.elements.updateBtn) {
            this.elements.updateBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.updateSteps();
            });
        }

        if (this.elements.input) {
            this.elements.input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.updateSteps();
                }
            });

            // Auto-focus on click
            this.elements.input.addEventListener('focus', () => {
                this.elements.input.select();
            });
        }
    },

    /**
     * Update step count
     */
    updateSteps() {
        const steps = parseInt(this.elements.input.value);
        
        if (isNaN(steps) || steps < 0) {
            this.showError('Please enter a valid number!');
            return;
        }

        if (steps > 100000) {
            this.showError('That seems too high! Please enter a realistic number.');
            return;
        }

        this.data.steps = steps;
        this.updateUI();
        this.elements.input.value = '';

        // Add to history
        const km = Utils.stepsToKm(steps);
        if (typeof History !== 'undefined') {
            History.addEntry(`Walked ${Utils.formatNumber(steps)} steps (${km} km)`);
        }

        // Motivational feedback
        this.provideFeedback(steps);

        // Visual feedback
        this.showSuccess();

        DataManager.saveData(this.data);
    },

    /**
     * Update step tracker UI
     */
    updateUI() {
        const steps = this.data.steps;
        const km = Utils.stepsToKm(steps);
        const progress = Math.min((steps / this.GOAL_STEPS) * 100, 100);

        this.elements.stepCount.textContent = Utils.formatNumber(steps);
        this.elements.kmDisplay.textContent = `${km} km`;
        this.elements.progressBar.style.width = `${progress}%`;
        this.elements.goalText.textContent = `${Utils.formatNumber(steps)} / ${Utils.formatNumber(this.GOAL_STEPS)} steps`;
    },

    /**
     * Provide motivational feedback
     * @param {number} steps - Number of steps
     */
    provideFeedback(steps) {
        if (typeof Coach === 'undefined') return;

        if (steps >= 10000) {
            Coach.addMessage('Coach', '🔥 10K steps! You\'re a machine!');
        } else if (steps >= 5000) {
            Coach.addMessage('Coach', 'Nice progress! Keep moving!');
        } else if (steps >= 2500) {
            Coach.addMessage('Coach', 'Good start! Keep it up!');
        }
    },

    /**
     * Show error message
     */
    showError(message) {
        alert(message);
        this.elements.input.focus();
    },

    /**
     * Show success feedback
     */
    showSuccess() {
        const btn = this.elements.updateBtn;
        if (!btn) return;

        const originalText = btn.textContent;
        btn.textContent = '✓ Updated';
        btn.style.background = 'var(--success)';

        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 1500);
    },

    /**
     * Get current steps
     * @returns {number} Current step count
     */
    getSteps() {
        return this.data.steps;
    },

    /**
     * Get kilometers
     * @returns {string} Kilometers
     */
    getKilometers() {
        return Utils.stepsToKm(this.data.steps);
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Steps;
}