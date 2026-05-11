/**
 * Main Application
 * Initializes and coordinates all modules.
 */

const App = {
    habitData: null,
    initialized: false,

    init() {
        if (this.initialized) return;

        this.habitData = DataManager.loadData();
        DataManager.initializeMonthlyData(this.habitData);
        this.initializeModules();
        this.setupErrorHandling();
        this.initialized = true;
    },

    initializeModules() {
        try {
            // Core
            Profile.init(this.habitData);
            Theme.init(this.habitData);

            // Features
            Steps.init(this.habitData);
            Goals.init(this.habitData);
            Stats.init(this.habitData);
            History.init(this.habitData);
            Alarms.init(this.habitData);
            Weather.init(this.habitData);
            Coach.init(this.habitData);

            // New modules
            Health.init(this.habitData);
            Analytics.init(this.habitData);
            Recurring.init(this.habitData);   // must come after Goals.init

            // Load saved notes
            Coach.loadNotes();

        } catch (error) {
            console.error('Error initializing modules:', error);
            this.handleInitializationError(error);
        }
    },

    setupErrorHandling() {
        window.addEventListener('error', (e) => console.error('Global error:', e.error));
        window.addEventListener('unhandledrejection', (e) => console.error('Unhandled rejection:', e.reason));
    },

    handleInitializationError(error) {
        if (confirm('Failed to initialize. Reset data?')) {
            DataManager.clearData();
            window.location.reload();
        }
    },

    destroy() {
        if (!this.initialized) return;
        if (Alarms)    Alarms.destroy();
        if (Weather)   Weather.destroy();
        if (Stats)     Stats.destroy();
        if (Analytics) Analytics.destroy();
        if (Recurring) Recurring.destroy();
        this.initialized = false;
    },

    getVersion() { return '2.0.0'; }
};

document.addEventListener('DOMContentLoaded', () => App.init());

window.addEventListener('beforeunload', () => {
    if (App.habitData) DataManager.saveData(App.habitData);
});

window.HabitTrackerApp = App;