/**
 * Profile Management
 * Handles user profile operations
 */

const Profile = {
    elements: {},
    data: null,

    /**
     * Initialize profile module
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
            toggle: document.getElementById('profileToggle'),
            dropdown: document.getElementById('profileDropdown'),
            name: document.getElementById('profileName'),
            email: document.getElementById('profileEmail'),
            streak: document.getElementById('profileStreak'),
            goals: document.getElementById('profileGoals'),
            viewHistoryBtn: document.getElementById('viewHistoryBtn'),
            editProfileBtn: document.getElementById('editProfileBtn'),
            viewSettingsBtn: document.getElementById('viewSettingsBtn'),
            logoutBtn: document.getElementById('logoutBtn')
        };
    },

    /**
     * Attach event listeners
     */
    attachEvents() {
        this.elements.toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        this.elements.editProfileBtn.addEventListener('click', () => {
            this.editProfile();
        });

        this.elements.viewHistoryBtn.addEventListener('click', () => {
            this.viewHistory();
        });

        this.elements.viewSettingsBtn.addEventListener('click', () => {
            this.viewSettings();
        });

        this.elements.logoutBtn.addEventListener('click', () => {
            this.logout();
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.elements.toggle.contains(e.target) && 
                !this.elements.dropdown.contains(e.target)) {
                this.closeDropdown();
            }
        });
    },

    /**
     * Toggle profile dropdown
     */
    toggleDropdown() {
        this.elements.dropdown.classList.toggle('active');
    },

    /**
     * Close profile dropdown
     */
    closeDropdown() {
        this.elements.dropdown.classList.remove('active');
    },

    /**
     * Edit profile name
     */
    editProfile() {
        const newName = prompt('Enter your name:', this.data.userName);
        if (newName && newName.trim() !== '') {
            this.data.userName = newName.trim();
            this.updateUI();
            DataManager.saveData(this.data);
            
            // Update greeting
            const greetingText = document.getElementById('greetingText');
            if (greetingText) {
                greetingText.textContent = `${Utils.getCurrentGreeting()}, ${this.data.userName} 👋`;
            }
        }
    },

    /**
     * View history
     */
    viewHistory() {
        alert('History section is displayed in the middle column below the graph!');
        this.closeDropdown();
    },

    /**
     * View settings
     */
    viewSettings() {
        alert('Settings are in the left sidebar - Theme, Streak toggle, and more!');
        this.closeDropdown();
    },

    /**
     * Logout
     */
    logout() {
        if (confirm('Are you sure you want to logout? Your data will be preserved.')) {
            alert('👋 Logged out successfully! Refreshing...');
            this.closeDropdown();
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        }
    },

    /**
     * Update profile UI
     */
    updateUI() {
        this.elements.name.textContent = this.data.userName;
        this.elements.streak.textContent = this.data.streak;
        
        const completedGoals = this.data.goals.filter(g => g.completed).length;
        this.elements.goals.textContent = completedGoals;
    },

    /**
     * Update profile stats
     */
    updateStats() {
        this.elements.streak.textContent = this.data.streak;
        const completedGoals = this.data.goals.filter(g => g.completed).length;
        this.elements.goals.textContent = completedGoals;
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Profile;
}