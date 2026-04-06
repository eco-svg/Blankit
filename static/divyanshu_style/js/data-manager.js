/**
 * Data Manager
 * Handles all localStorage operations and data persistence
 */

const DataManager = {
    STORAGE_KEY: 'habitTrackerData',
    
    /**
     * Default data structure
     */
    getDefaultData() {
        return {
            streak: 0,
            goals: [],
            completedToday: 0,
            steps: 0,
            monthlyData: {},
            alarms: [],
            notes: '',
            streakEnabled: true,
            theme: 'dark',
            history: [],
            userName: 'Divyanshu'
        };
    },

    /**
     * Load data from localStorage
     * @returns {Object} Habit data
     */
    loadData() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                const data = JSON.parse(saved);
                return { ...this.getDefaultData(), ...data };
            }
        } catch (error) {
            console.error('Error loading data:', error);
        }
        return this.getDefaultData();
    },

    /**
     * Save data to localStorage
     * @param {Object} data - Data to save
     */
    saveData(data) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
        } catch (error) {
            console.error('Error saving data:', error);
        }
    },

    /**
     * Clear all data
     */
    clearData() {
        try {
            localStorage.removeItem(this.STORAGE_KEY);
        } catch (error) {
            console.error('Error clearing data:', error);
        }
    },

    /**
     * Initialize monthly data for current month
     * @param {Object} data - Habit data
     */
    initializeMonthlyData(data) {
        const currentMonth = Utils.getCurrentMonth();
        if (!data.monthlyData[currentMonth]) {
            data.monthlyData[currentMonth] = {
                days: {},
                totalGoals: 0,
                completedGoals: 0
            };
        }
    },

    /**
     * Update monthly statistics
     * @param {Object} data - Habit data
     */
    updateMonthlyData(data) {
        const currentMonth = Utils.getCurrentMonth();
        const today = Utils.getCurrentDate();
        const monthData = data.monthlyData[currentMonth];

        const todayGoals = data.goals.filter(g => 
            g.createdAt.startsWith(currentMonth)
        );
        const todayCompleted = todayGoals.filter(g => g.completed).length;

        monthData.days[today] = {
            completed: todayCompleted,
            total: todayGoals.length
        };

        monthData.totalGoals = todayGoals.length;
        monthData.completedGoals = todayCompleted;
    },

    /**
     * Get last N days of data
     * @param {Object} monthData - Monthly data
     * @param {number} days - Number of days
     * @returns {Array} Array of day data
     */
    getLastNDays(monthData, days = 30) {
        const result = [];
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().slice(0, 10);
            const dayData = monthData.days[dateStr] || { completed: 0, total: 0 };
            
            result.push({
                date: date.getDate(),
                completed: dayData.completed,
                total: dayData.total
            });
        }
        return result;
    },

    /**
     * Export data as JSON
     * @param {Object} data - Data to export
     * @returns {string} JSON string
     */
    exportData(data) {
        return JSON.stringify(data, null, 2);
    },

    /**
     * Import data from JSON
     * @param {string} jsonString - JSON data
     * @returns {Object} Parsed data
     */
    importData(jsonString) {
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            console.error('Error importing data:', error);
            return null;
        }
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataManager;
}