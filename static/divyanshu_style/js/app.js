/**
 * Main Application
 * Initializes and coordinates all modules
 */

const App = {
    habitData: null,
    initialized: false,

    /**
     * Initialize application
     */
    init() {
        if (this.initialized) {
            console.warn('App already initialized');
            return;
        }

        console.log('Initializing Habit Tracker...');

        // Load data
        this.habitData = DataManager.loadData();
        
        // Initialize monthly data
        DataManager.initializeMonthlyData(this.habitData);

        // Initialize all modules
        this.initializeModules();

        // Setup error handling
        this.setupErrorHandling();

        this.initialized = true;
        console.log('Habit Tracker initialized successfully');
    },

    /**
     * Initialize all application modules
     */
    initializeModules() {
        try {
            // Core modules
            Profile.init(this.habitData);
            Theme.init(this.habitData);
            
            // Feature modules
            Steps.init(this.habitData);
            Goals.init(this.habitData);
            Stats.init(this.habitData);
            History.init(this.habitData);
            Alarms.init(this.habitData);
            Weather.init(this.habitData);
            Coach.init(this.habitData);

            // Load saved notes
            Coach.loadNotes();

        } catch (error) {
            console.error('Error initializing modules:', error);
            this.handleInitializationError(error);
        }
    },

    /**
     * Setup global error handling
     */
    setupErrorHandling() {
        window.addEventListener('error', (event) => {
            console.error('Global error:', event.error);
            this.logError(event.error);
        });

        window.addEventListener('unhandledrejection', (event) => {
            console.error('Unhandled promise rejection:', event.reason);
            this.logError(event.reason);
        });
    },

    /**
     * Handle initialization errors
     * @param {Error} error - Error object
     */
    handleInitializationError(error) {
        const errorMessage = 'Failed to initialize application. Please refresh the page.';
        console.error(errorMessage, error);
        
        // Show user-friendly error
        if (confirm(errorMessage + '\n\nWould you like to reset your data?')) {
            this.resetApplication();
        }
    },

    /**
     * Log error for debugging
     * @param {Error} error - Error object
     */
    logError(error) {
        // In production, send to error tracking service
        const errorLog = {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent
        };
        
        console.error('Error log:', errorLog);
    },

    /**
     * Reset application data
     */
    resetApplication() {
        if (confirm('This will delete all your data. Are you sure?')) {
            DataManager.clearData();
            window.location.reload();
        }
    },

    /**
     * Cleanup and destroy application
     */
    destroy() {
        if (!this.initialized) return;

        console.log('Destroying Habit Tracker...');

        // Stop intervals
        if (Alarms) Alarms.destroy();
        if (Weather) Weather.destroy();
        if (Stats) Stats.destroy();

        this.initialized = false;
        console.log('Habit Tracker destroyed');
    },

    /**
     * Get application version
     * @returns {string} Version number
     */
    getVersion() {
        return '1.0.0';
    },

    /**
     * Get application info
     * @returns {Object} App info
     */
    getInfo() {
        return {
            name: 'AI Habit Architect',
            version: this.getVersion(),
            author: 'Divyanshu',
            initialized: this.initialized,
            dataSize: JSON.stringify(this.habitData).length
        };
    }
};

/**
 * Auto-initialize on DOM ready
 */
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

/**
 * Cleanup on page unload
 */
window.addEventListener('beforeunload', () => {
    // Final save before leaving
    if (App.habitData) {
        DataManager.saveData(App.habitData);
    }
});

// Export for external access
if (typeof module !== 'undefined' && module.exports) {
    module.exports = App;
}

// Make App globally accessible for debugging
window.HabitTrackerApp = App;