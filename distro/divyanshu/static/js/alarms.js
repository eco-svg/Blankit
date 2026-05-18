/**
 * Alarm System
 * Handles reminders and browser notifications
 */

const Alarms = {
    elements: {},
    data: null,
    checkInterval: null,

    /**
     * Initialize alarms module
     */
    init(habitData) {
        this.data = habitData;
        this.cacheElements();
        this.attachEvents();
        this.render();
        this.requestPermission();
        this.startChecking();
    },

    /**
     * Cache DOM elements
     */
    cacheElements() {
        this.elements = {
            input: document.getElementById('alarmTime'),
            setBtn: document.getElementById('setAlarmBtn'),
            list: document.getElementById('alarmList')
        };

        // Verify elements exist
        if (!this.elements.setBtn) {
            console.error('Set alarm button not found!');
        }
    },

    /**
     * Attach event listeners
     */
    attachEvents() {
        if (this.elements.setBtn) {
            this.elements.setBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.setAlarm();
            });
        }

        if (this.elements.input) {
            this.elements.input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.setAlarm();
                }
            });
        }
    },

    /**
     * Request notification permission
     */
    requestPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    },

    /**
     * Set new alarm
     */
    setAlarm() {
        const time = this.elements.input.value;
        
        if (time === '') {
            alert('Please set a time!');
            this.elements.input.focus();
            return;
        }

        // Check if alarm already exists for this time
        const exists = this.data.alarms.some(a => a.time === time && a.active);
        if (exists) {
            alert('An alarm already exists for this time!');
            return;
        }

        if (Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    this.createAlarm(time);
                } else {
                    alert('Please enable notifications to use alarms!');
                }
            });
        } else if (Notification.permission === 'granted') {
            this.createAlarm(time);
        } else {
            alert('Notifications are blocked. Please enable them in browser settings.');
        }
    },

    /**
     * Create alarm
     * @param {string} time - Time in HH:MM format
     */
    createAlarm(time) {
        const alarm = {
            id: Date.now(),
            time: time,
            active: true
        };

        this.data.alarms.push(alarm);
        this.render();
        DataManager.saveData(this.data);

        if (typeof History !== 'undefined') {
            History.addEntry(`Set reminder for ${time}`);
        }

        if (typeof Coach !== 'undefined') {
            Coach.addMessage('Coach', `Got it! I'll remind you at ${time}. Don't let me down!`);
        }

        this.elements.input.value = '';
        this.showSuccess();
    },

    /**
     * Delete alarm
     * @param {number} alarmId - Alarm ID
     */
    deleteAlarm(alarmId) {
        const alarm = this.data.alarms.find(a => a.id === alarmId);
        
        if (alarm && typeof History !== 'undefined') {
            History.addEntry(`Deleted reminder for ${alarm.time}`);
        }

        this.data.alarms = this.data.alarms.filter(a => a.id !== alarmId);
        this.render();
        DataManager.saveData(this.data);
    },

    /**
     * Check alarms
     */
    checkAlarms() {
        const currentTime = Utils.getCurrentTime();

        this.data.alarms.forEach(alarm => {
            if (alarm.active && alarm.time === currentTime) {
                this.triggerAlarm(alarm);
            }
        });
    },

    /**
     * Trigger alarm notification
     * @param {Object} alarm - Alarm object
     */
    triggerAlarm(alarm) {
        if (Notification.permission === 'granted') {
            const notification = new Notification('⏰ Habit Tracker Reminder', {
                body: `It's ${alarm.time}! Time to work on your goals!`,
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="75">⏰</text></svg>',
                requireInteraction: true,
                tag: 'habit-alarm'
            });

            // Auto-close after 10 seconds
            setTimeout(() => notification.close(), 10000);
        }

        alarm.active = false;

        if (typeof Coach !== 'undefined') {
            Coach.addMessage('Coach', `🔔 Alarm triggered at ${alarm.time}!`);
        }

        if (typeof History !== 'undefined') {
            History.addEntry(`Reminder triggered for ${alarm.time}`);
        }

        DataManager.saveData(this.data);
        this.render();
    },

    /**
     * Start alarm checking interval
     */
    startChecking() {
        // Check every minute
        this.checkInterval = setInterval(() => {
            this.checkAlarms();
        }, 60000);

        // Also check immediately
        this.checkAlarms();
    },

    /**
     * Stop alarm checking
     */
    stopChecking() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    },

    /**
     * Render alarm list
     */
    render() {
        this.elements.list.innerHTML = '';

        if (this.data.alarms.length === 0) {
            return;
        }

        // Sort alarms by time
        const sortedAlarms = [...this.data.alarms].sort((a, b) => 
            a.time.localeCompare(b.time)
        );

        sortedAlarms.forEach(alarm => {
            const element = this.createAlarmElement(alarm);
            this.elements.list.appendChild(element);
        });
    },

    /**
     * Create alarm element
     * @param {Object} alarm - Alarm object
     * @returns {HTMLElement} Alarm element
     */
    createAlarmElement(alarm) {
        const div = document.createElement('div');
        div.className = 'alarm-item';
        if (!alarm.active) {
            div.style.opacity = '0.5';
        }

        const span = document.createElement('span');
        span.textContent = `⏰ ${alarm.time}`;
        if (!alarm.active) {
            span.textContent += ' (triggered)';
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => this.deleteAlarm(alarm.id));

        div.appendChild(span);
        div.appendChild(deleteBtn);

        return div;
    },

    /**
     * Show success feedback
     */
    showSuccess() {
        const btn = this.elements.setBtn;
        if (!btn) return;

        const originalText = btn.textContent;
        btn.textContent = '✓ Set';
        btn.style.background = 'var(--success)';

        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 1500);
    },

    /**
     * Cleanup
     */
    destroy() {
        this.stopChecking();
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Alarms;
}