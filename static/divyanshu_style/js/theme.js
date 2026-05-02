/**
 * Theme Management
 * Handles theme switching and persistence
 */

const Theme = {
    data: null,
    buttons: [],

    /**
     * Initialize theme module
     */
    init(habitData) {
        this.data = habitData;
        this.buttons = document.querySelectorAll('.theme-btn');
        this.attachEvents();
        this.applyTheme(this.data.theme);
    },

    /**
     * Attach event listeners
     */
    attachEvents() {
        this.buttons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const theme = e.target.dataset.theme;
                this.changeTheme(theme);
            });
        });
    },

    /**
     * Change theme
     * @param {string} theme - Theme name (dark, light, ocean)
     */
    changeTheme(theme) {
        this.data.theme = theme;
        this.applyTheme(theme);
        DataManager.saveData(this.data);
        
        // Update chart colors if chart exists
        if (typeof Stats !== 'undefined' && Stats.updateChart) {
            Stats.updateChart();
        }
    },

    /**
     * Apply theme to document
     * @param {string} theme - Theme name
     */
    applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        this.updateActiveButton(theme);
    },

    /**
     * Update active theme button
     * @param {string} theme - Theme name
     */
    updateActiveButton(theme) {
        this.buttons.forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.theme === theme) {
                btn.classList.add('active');
            }
        });
    },

    /**
     * Get current theme
     * @returns {string} Current theme name
     */
    getCurrentTheme() {
        return this.data.theme;
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Theme;
}