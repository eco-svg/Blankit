/**
 * Activity History
 * Tracks and displays user activity history
 */

const History = {
    elements: {},
    data: null,
    MAX_HISTORY: 50,
    DISPLAY_LIMIT: 10,

    /**
     * Initialize history module
     */
    init(habitData) {
        this.data = habitData;
        this.cacheElements();
        this.render();
    },

    /**
     * Cache DOM elements
     */
    cacheElements() {
        this.elements = {
            list: document.getElementById('historyList')
        };
    },

    /**
     * Add history entry
     * @param {string} action - Action description
     */
    addEntry(action) {
        const entry = {
            id: Date.now(),
            action: Utils.sanitizeHTML(action),
            timestamp: new Date().toISOString()
        };

        this.data.history.unshift(entry);

        // Keep only last N items
        if (this.data.history.length > this.MAX_HISTORY) {
            this.data.history = this.data.history.slice(0, this.MAX_HISTORY);
        }

        this.render();
        DataManager.saveData(this.data);
    },

    /**
     * Render history list
     */
    render() {
        this.elements.list.innerHTML = '';

        if (this.data.history.length === 0) {
            this.renderEmptyState();
            return;
        }

        const displayItems = this.data.history.slice(0, this.DISPLAY_LIMIT);
        displayItems.forEach(item => {
            const element = this.createHistoryElement(item);
            this.elements.list.appendChild(element);
        });
    },

    /**
     * Render empty state
     */
    renderEmptyState() {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
            <div class="history-date">No activity yet</div>
            <div class="history-content">Start adding goals to build your history!</div>
        `;
        this.elements.list.appendChild(div);
    },

    /**
     * Create history element
     * @param {Object} item - History item
     * @returns {HTMLElement} History element
     */
    createHistoryElement(item) {
        const div = document.createElement('div');
        div.className = 'history-item';

        const date = new Date(item.timestamp);
        const timeAgo = Utils.getTimeAgo(date);

        const dateDiv = document.createElement('div');
        dateDiv.className = 'history-date';
        dateDiv.textContent = timeAgo;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'history-content';
        contentDiv.textContent = item.action;

        div.appendChild(dateDiv);
        div.appendChild(contentDiv);

        return div;
    },

    /**
     * Clear history
     */
    clearHistory() {
        if (confirm('Are you sure you want to clear all history?')) {
            this.data.history = [];
            this.render();
            DataManager.saveData(this.data);
        }
    },

    /**
     * Get recent entries
     * @param {number} limit - Number of entries
     * @returns {Array} Recent history entries
     */
    getRecent(limit = 10) {
        return this.data.history.slice(0, limit);
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = History;
}