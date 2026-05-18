/**
 * Profile Management
 * Handles user profile operations.
 *
 * FIX: updateUI() now also refreshes the email element.
 * FIX: logout() redirects to /logout instead of reloading the page.
 * FIX: Profile name and email are always kept in sync with the
 *      current session user (document.querySelector('meta[name="app-user"]')?.content).
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
            toggle:         document.getElementById('profileToggle'),
            dropdown:       document.getElementById('profileDropdown'),
            name:           document.getElementById('profileName'),
            email:          document.getElementById('profileEmail'),
            streak:         document.getElementById('profileStreak'),
            goals:          document.getElementById('profileGoals'),
            viewHistoryBtn: document.getElementById('viewHistoryBtn'),
            editProfileBtn: document.getElementById('editProfileBtn'),
            viewSettingsBtn:document.getElementById('viewSettingsBtn'),
            logoutBtn:      document.getElementById('logoutBtn')
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
     * Edit profile display name (stored in localStorage only)
     */
    editProfile() {
        const newName = prompt('Enter your display name:', this.data.userName);
        if (newName && newName.trim() !== '') {
            this.data.userName = newName.trim();
            this.updateUI();
            DataManager.saveData(this.data);

            // Update greeting banner
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
        alert('Settings are in the left sidebar — Theme, Streak toggle, and more!');
        this.closeDropdown();
    },

    /**
     * Logout
     * FIX: Redirects to the real /logout route instead of reloading the page.
     * The final save ensures no data is lost before the session ends.
     */
    logout() {
    if (confirm('Are you sure you want to logout? Your data will be preserved.')) {
        this.closeDropdown();
        if (this.data) { DataManager.saveData(this.data); }

        // POST to /auth/logout then redirect to homepage
        fetch('/auth/logout', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                window.location.href = data.redirect || '/';
            })
            .catch(() => {
                window.location.href = '/';
            });
    }
},

    /**
     * Update profile UI.
     * FIX: email element is also updated so it reflects the real session user,
     *      not a hardcoded placeholder.
     */
    updateUI() {
        // Name: prefer data.userName (editable display name), fall back to session
        const displayName = this.data.userName || document.querySelector('meta[name="app-user"]')?.content || 'User';
        this.elements.name.textContent = displayName;

        // Email: always derived from the actual session username
        if (this.elements.email) {
            const sessionUser = (document.querySelector('meta[name="app-user"]')?.content || displayName).toLowerCase();
            this.elements.email.textContent = `${sessionUser}@habittracker.com`;
        }

        this.updateStats();
    },

    /**
     * Update profile stats (streak + completed goals counter)
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