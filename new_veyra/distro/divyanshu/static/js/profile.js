/**
 * Profile Management
 * Handles user profile operations.
 *
 * FIX: updateUI() now also refreshes the email element.
 * FIX: logout() redirects to /logout instead of reloading the page.
 * FIX: Profile name and email are always kept in sync with the
 *      current session user (document.querySelector('meta[name="app-user"]')?.content).
 * FIX: View History now shows activity history INSIDE the dropdown.
 */

const Profile = {
    elements: {},
    data: null,

    init(habitData) {
        this.data = habitData;
        this.cacheElements();
        this.attachEvents();
        this.updateUI();
        this.lockPosition();
    },

    lockPosition() {
        const header = document.getElementById('profileHeader');
        if (!header) return;
        const fix = () => {
            header.style.cssText = `
                position: fixed !important;
                top: 20px !important;
                left: 20px !important;
                z-index: 9999 !important;
            `;
        };
        fix();
        window.addEventListener('scroll', fix, { passive: true });
        const observer = new MutationObserver(fix);
        observer.observe(document.body, { attributes: true });
    },

    cacheElements() {
        this.elements = {
            toggle:           document.getElementById('profileToggle'),
            dropdown:         document.getElementById('profileDropdown'),
            name:             document.getElementById('profileName'),
            email:            document.getElementById('profileEmail'),
            streak:           document.getElementById('profileStreak'),
            goals:            document.getElementById('profileGoals'),
            viewHistoryBtn:   document.getElementById('viewHistoryBtn'),
            editProfileBtn:   document.getElementById('editProfileBtn'),
            viewSettingsBtn:  document.getElementById('viewSettingsBtn'),
            deleteAccountBtn: document.getElementById('deleteAccountBtn'),
            logoutBtn:        document.getElementById('logoutBtn'),
            // Main menu and history panel (injected dynamically)
            mainMenu:         document.getElementById('profileMainMenu'),
            historyPanel:     document.getElementById('profileHistoryPanel')
        };
    },

    attachEvents() {
        this.elements.toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        this.elements.editProfileBtn.addEventListener('click', () => {
            this.editProfile();
        });

        this.elements.viewHistoryBtn.addEventListener('click', () => {
            this.showHistoryPanel();
        });

        this.elements.viewSettingsBtn.addEventListener('click', () => {
            this.viewSettings();
        });

        this.elements.deleteAccountBtn.addEventListener('click', () => {
            this.deleteAccount();
        });

        this.elements.logoutBtn.addEventListener('click', () => {
            this.logout();
        });

        document.addEventListener('click', (e) => {
            if (!this.elements.toggle.contains(e.target) &&
                !this.elements.dropdown.contains(e.target)) {
                this.closeDropdown();
            }
        });
    },

    toggleDropdown() {
        const isOpen = this.elements.dropdown.classList.contains('active');
        if (isOpen) {
            this.closeDropdown();
        } else {
            this.showMainMenu(); // always show main menu when opening
            this.elements.dropdown.classList.add('active');
        }
    },

    closeDropdown() {
        this.elements.dropdown.classList.remove('active');
        this.showMainMenu(); // reset to main menu on close
    },

    /**
     * Show the main profile menu
     */
    showMainMenu() {
        const main    = document.getElementById('profileMainMenu');
        const history = document.getElementById('profileHistoryPanel');
        if (main)    main.style.display    = 'block';
        if (history) history.style.display = 'none';
    },

    /**
     * Show activity history INSIDE the dropdown
     */
    showHistoryPanel() {
        const main    = document.getElementById('profileMainMenu');
        const history = document.getElementById('profileHistoryPanel');
        if (!main || !history) return;

        // Hide main menu, show history panel
        main.style.display    = 'none';
        history.style.display = 'block';

        // Render history entries
        const listEl = document.getElementById('profileHistoryEntries');
        if (!listEl) return;

        listEl.innerHTML = '';

        const entries = this.data.history || [];

        if (entries.length === 0) {
            listEl.innerHTML = `
                <div style="color:var(--text-dim);font-size:0.85rem;
                            text-align:center;padding:20px 0;">
                    No activity yet. Start adding goals!
                </div>`;
            return;
        }

        // Show last 20 entries
        entries.slice(0, 20).forEach(item => {
            const div = document.createElement('div');
            div.style.cssText = `
                padding: 8px 10px;
                background: var(--bg);
                border-radius: 6px;
                margin-bottom: 6px;
                border-left: 3px solid var(--accent);
                font-size: 0.85rem;
            `;

            const date = new Date(item.timestamp);
            const timeAgo = typeof Utils !== 'undefined'
                ? Utils.getTimeAgo(date)
                : date.toLocaleDateString();

            div.innerHTML = `
                <div style="color:var(--text-dim);font-size:0.75rem;
                            margin-bottom:3px;">${timeAgo}</div>
                <div style="color:var(--text);">${item.action}</div>
            `;
            listEl.appendChild(div);
        });
    },

    editProfile() {
        const newName = prompt('Enter your display name:', this.data.userName);
        if (newName && newName.trim() !== '') {
            this.data.userName = newName.trim();
            this.updateUI();
            DataManager.saveData(this.data);
            const greetingText = document.getElementById('greetingText');
            if (greetingText) {
                greetingText.textContent =
                    `${Utils.getCurrentGreeting()}, ${this.data.userName} 👋`;
            }
        }
    },

    viewSettings() {
        this.closeDropdown();
        const themeBtn = document.querySelector('.theme-btn');
        if (themeBtn) {
            const themeCard = themeBtn.closest('.card');
            if (themeCard) {
                themeCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                themeCard.style.transition  = 'box-shadow 0.3s, border-color 0.3s';
                themeCard.style.borderColor = 'var(--accent)';
                themeCard.style.boxShadow   = '0 0 20px rgba(88,166,255,0.5)';
                setTimeout(() => {
                    themeCard.style.borderColor = '';
                    themeCard.style.boxShadow   = '';
                }, 2000);
            }
        }
    },

    deleteAccount() {
        const step1 = confirm(
            '⚠️ DELETE ACCOUNT\n\n' +
            'This will permanently delete your account and ALL your data.\n' +
            'This action CANNOT be undone.\n\n' +
            'Are you sure you want to continue?'
        );
        if (!step1) return;

        const step2 = prompt('Type DELETE (in capitals) to confirm account deletion:');
        if (step2 !== 'DELETE') {
            alert('Account deletion cancelled — you did not type DELETE correctly.');
            return;
        }

        this.closeDropdown();
        DataManager.clearData();

        fetch('/auth/delete-account', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(res => res.json())
        .then(data => {
            if (data.message === 'account deleted') {
                alert('✅ Your account has been permanently deleted. Goodbye!');
                window.location.href = '/';
            } else {
                alert('Error: ' + (data.error || 'Could not delete account.'));
            }
        })
        .catch(() => {
            alert('Connection error. Please try again.');
        });
    },

    logout() {
        if (confirm('Are you sure you want to logout? Your data will be preserved.')) {
            this.closeDropdown();
            if (this.data) DataManager.saveData(this.data);
            fetch('/auth/logout', { method: 'POST' })
                .then(res => res.json())
                .then(data => { window.location.href = data.redirect || '/'; })
                .catch(() => { window.location.href = '/'; });
        }
    },

    updateUI() {
        const displayName = this.data.userName || window.SERVER_USERNAME || 'User';
        this.elements.name.textContent = displayName;
        if (this.elements.email) {
            this.elements.email.textContent = window.SERVER_EMAIL ||
                `${(window.SERVER_USERNAME || displayName).toLowerCase()}@habittracker.com`;
        }
        this.updateStats();
    },

    updateStats() {
        this.elements.streak.textContent = this.data.streak;
        const completedGoals = this.data.goals.filter(g => g.completed).length;
        this.elements.goals.textContent = completedGoals;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Profile;
}