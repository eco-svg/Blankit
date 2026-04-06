/**
 * Goal Management
 * Handles goal creation, completion, and deletion
 */

const Goals = {
    elements: {},
    data: null,

    /**
     * Initialize goals module
     */
    init(habitData) {
        this.data = habitData;
        this.cacheElements();
        this.attachEvents();
        this.render();
    },

    /**
     * Cache DOM elements
     */
    cacheElements() {
        this.elements = {
            list: document.getElementById('goalList'),
            input: document.getElementById('goalInput'),
            addBtn: document.getElementById('addGoalBtn'),
            streakToggle: document.getElementById('streakToggle'),
            streakPill: document.getElementById('streakPill'),
            streakCount: document.getElementById('streakCount')
        };
    },

    /**
     * Attach event listeners
     */
    attachEvents() {
        if (this.elements.addBtn) {
            this.elements.addBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.addGoal();
            });
        }

        if (this.elements.input) {
            this.elements.input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.addGoal();
                }
            });

            // Auto-focus on click
            this.elements.input.addEventListener('focus', () => {
                this.elements.input.select();
            });
        }

        if (this.elements.streakToggle) {
            this.elements.streakToggle.addEventListener('click', () => {
                this.toggleStreak();
            });
        }
    },

    /**
     * Add new goal
     */
    addGoal() {
        const goalText = this.elements.input.value.trim();
        
        if (goalText === '') {
            alert('Please enter a goal!');
            this.elements.input.focus();
            return;
        }

        if (goalText.length > 200) {
            alert('Goal is too long! Please keep it under 200 characters.');
            return;
        }

        // Check for duplicate goals
        const duplicate = this.data.goals.some(g => 
            g.text.toLowerCase() === goalText.toLowerCase() && !g.completed
        );
        if (duplicate) {
            if (!confirm('You already have this goal. Add it anyway?')) {
                return;
            }
        }

        const goal = {
            id: Date.now(),
            text: Utils.sanitizeHTML(goalText),
            completed: false,
            createdAt: new Date().toISOString(),
            completedAt: null
        };

        this.data.goals.push(goal);
        this.elements.input.value = '';

        if (typeof History !== 'undefined') {
            History.addEntry(`Added goal: ${goal.text}`);
        }

        this.render();
        this.updateMonthlyStats();
        this.showSuccess();
        DataManager.saveData(this.data);
    },

    /**
     * Toggle goal completion
     * @param {number} goalId - Goal ID
     */
    toggleGoal(goalId) {
        const goal = this.data.goals.find(g => g.id === goalId);
        if (!goal) return;

        goal.completed = !goal.completed;
        goal.completedAt = goal.completed ? new Date().toISOString() : null;

        if (goal.completed) {
            this.data.completedToday++;
            if (typeof History !== 'undefined') {
                History.addEntry(`Completed: ${goal.text}`);
            }
            this.updateStreak();
            this.celebrateCompletion(goal);
        } else {
            this.data.completedToday--;
        }

        this.render();
        this.updateMonthlyStats();
        DataManager.saveData(this.data);
    },

    /**
     * Delete goal
     * @param {number} goalId - Goal ID
     */
    deleteGoal(goalId) {
        const goal = this.data.goals.find(g => g.id === goalId);
        if (!goal) return;

        if (!confirm(`Delete goal: "${goal.text}"?`)) {
            return;
        }

        if (typeof History !== 'undefined') {
            History.addEntry(`Deleted goal: ${goal.text}`);
        }

        this.data.goals = this.data.goals.filter(g => g.id !== goalId);
        this.render();
        this.updateMonthlyStats();
        DataManager.saveData(this.data);
    },

    /**
     * Toggle streak display
     */
    toggleStreak() {
        this.data.streakEnabled = !this.data.streakEnabled;
        this.elements.streakToggle.classList.toggle('active');
        
        if (this.data.streakEnabled) {
            this.elements.streakPill.classList.remove('hidden');
        } else {
            this.elements.streakPill.classList.add('hidden');
        }

        DataManager.saveData(this.data);
    },

    /**
     * Update streak count
     */
    updateStreak() {
        const today = Utils.getCurrentDate();
        const currentMonth = Utils.getCurrentMonth();
        
        if (!this.data.monthlyData[currentMonth].days[today]) {
            this.data.monthlyData[currentMonth].days[today] = {
                completed: 0,
                total: 0
            };
        }

        if (this.data.completedToday > 0) {
            this.data.streak++;
        }

        this.elements.streakCount.textContent = this.data.streak;
        
        if (typeof Profile !== 'undefined') {
            Profile.updateStats();
        }

        DataManager.saveData(this.data);
    },

    /**
     * Update monthly statistics
     */
    updateMonthlyStats() {
        DataManager.updateMonthlyData(this.data);
        
        if (typeof Stats !== 'undefined') {
            Stats.updateStats();
        }

        if (typeof Profile !== 'undefined') {
            Profile.updateStats();
        }
    },

    /**
     * Celebrate goal completion
     */
    celebrateCompletion(goal) {
        if (typeof Coach === 'undefined') return;

        const completedCount = this.data.goals.filter(g => g.completed).length;
        const totalCount = this.data.goals.length;

        if (completedCount === totalCount && totalCount > 0) {
            Coach.addMessage('Coach', '🎉 All goals completed! You\'re unstoppable!');
        } else if (completedCount === 1) {
            Coach.addMessage('Coach', '🎯 First goal down! Keep the momentum going!');
        } else if (completedCount % 5 === 0) {
            Coach.addMessage('Coach', `💪 ${completedCount} goals completed! You're on fire!`);
        }
    },

    /**
     * Render goal list
     */
    render() {
        this.elements.list.innerHTML = '';

        if (this.data.goals.length === 0) {
            this.renderEmptyState();
            return;
        }

        // Separate active and completed goals
        const activeGoals = this.data.goals.filter(g => !g.completed);
        const completedGoals = this.data.goals.filter(g => g.completed);

        // Render active goals first
        activeGoals.forEach(goal => {
            const goalItem = this.createGoalElement(goal);
            this.elements.list.appendChild(goalItem);
        });

        // Then completed goals
        completedGoals.forEach(goal => {
            const goalItem = this.createGoalElement(goal);
            this.elements.list.appendChild(goalItem);
        });
    },

    /**
     * Render empty state
     */
    renderEmptyState() {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.innerHTML = `
            <div class="empty-state-icon">🎯</div>
            <div>No goals yet. Add your first goal!</div>
        `;
        this.elements.list.appendChild(emptyDiv);
    },

    /**
     * Create goal DOM element
     * @param {Object} goal - Goal object
     * @returns {HTMLElement} Goal element
     */
    createGoalElement(goal) {
        const div = document.createElement('div');
        div.className = 'goal-item' + (goal.completed ? ' completed' : '');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = goal.completed;
        checkbox.addEventListener('change', () => this.toggleGoal(goal.id));

        const span = document.createElement('span');
        span.style.flexGrow = '1';
        span.textContent = goal.text;

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '🗑️';
        deleteBtn.title = 'Delete goal';
        deleteBtn.style.padding = '5px 10px';
        deleteBtn.style.fontSize = '0.8rem';
        deleteBtn.style.background = 'var(--fire)';
        deleteBtn.addEventListener('click', () => this.deleteGoal(goal.id));

        div.appendChild(checkbox);
        div.appendChild(span);
        div.appendChild(deleteBtn);

        return div;
    },

    /**
     * Show success feedback
     */
    showSuccess() {
        const btn = this.elements.addBtn;
        if (!btn) return;

        const originalText = btn.textContent;
        btn.textContent = '✓ Added';
        btn.style.background = 'var(--success)';

        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 1500);
    },

    /**
     * Get completed goals count
     * @returns {number} Number of completed goals
     */
    getCompletedCount() {
        return this.data.goals.filter(g => g.completed).length;
    },

    /**
     * Clear completed goals
     */
    clearCompleted() {
        const completedCount = this.data.goals.filter(g => g.completed).length;
        
        if (completedCount === 0) {
            alert('No completed goals to clear!');
            return;
        }

        if (!confirm(`Delete ${completedCount} completed goal(s)?`)) {
            return;
        }

        this.data.goals = this.data.goals.filter(g => !g.completed);
        
        if (typeof History !== 'undefined') {
            History.addEntry(`Cleared ${completedCount} completed goals`);
        }

        this.render();
        this.updateMonthlyStats();
        DataManager.saveData(this.data);
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Goals;
}