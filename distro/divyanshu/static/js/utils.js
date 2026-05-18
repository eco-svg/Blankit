/**
 * Utility Functions
 * Common helper functions used across the application
 */

const Utils = {
    /**
     * Get current greeting based on time of day
     * @returns {string} Greeting message
     */
    getCurrentGreeting() {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good Morning';
        if (hour < 18) return 'Good Afternoon';
        return 'Good Evening';
    },

    /**
     * Calculate time ago from timestamp
     * @param {Date} date - Date object
     * @returns {string} Human readable time ago
     */
    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
        return date.toLocaleDateString();
    },

    /**
     * Get current date in ISO format (YYYY-MM-DD)
     * @returns {string} Current date
     */
    getCurrentDate() {
        return new Date().toISOString().slice(0, 10);
    },

    /**
     * Get current month in ISO format (YYYY-MM)
     * @returns {string} Current month
     */
    getCurrentMonth() {
        return new Date().toISOString().slice(0, 7);
    },

    /**
     * Format number with commas
     * @param {number} num - Number to format
     * @returns {string} Formatted number
     */
    formatNumber(num) {
        return num.toLocaleString();
    },

    /**
     * Calculate percentage
     * @param {number} part - Part value
     * @param {number} total - Total value
     * @returns {number} Percentage
     */
    calculatePercentage(part, total) {
        return total > 0 ? Math.round((part / total) * 100) : 0;
    },

    /**
     * Convert steps to kilometers
     * @param {number} steps - Number of steps
     * @returns {string} Kilometers with 2 decimal places
     */
    stepsToKm(steps) {
        return (steps / 1250).toFixed(2);
    },

    /**
     * Get current time in HH:MM format
     * @returns {string} Current time
     */
    getCurrentTime() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    },

    /**
     * Debounce function execution
     * @param {Function} func - Function to debounce
     * @param {number} wait - Wait time in milliseconds
     * @returns {Function} Debounced function
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    /**
     * Sanitize HTML to prevent XSS
     * @param {string} str - String to sanitize
     * @returns {string} Sanitized string
     */
    sanitizeHTML(str) {
        const temp = document.createElement('div');
        temp.textContent = str;
        return temp.innerHTML;
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
}