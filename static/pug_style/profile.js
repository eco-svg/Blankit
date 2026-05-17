document.addEventListener('DOMContentLoaded', () => {

    const ppChangeUsername = document.getElementById('ppChangeUsername');
    const ppChangePassword = document.getElementById('ppChangePassword');
    const ppDeleteAccount  = document.getElementById('ppDeleteAccount');
    const profilePopup     = document.getElementById('profilePopup');
    const langBtns         = document.querySelectorAll('.pp-lang-btn');

    function closePopup() { profilePopup?.classList.add('hidden'); }

    // ── Change Username ──────────────────────────────────────────────────────
    ppChangeUsername?.addEventListener('click', () => {
        closePopup();
        const val = prompt('New username:');
        if (!val || !val.trim()) return;
        fetch('/pug/api/profile/username', {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ username: val.trim() })
        })
        .then(r => r.json())
        .then(data => {
            if (data.error) { alert(data.error); return; }
            // Update visible name in header without reload
            const nameEl = document.querySelector('.greeting-name');
            if (nameEl) nameEl.textContent = data.username;
            // stats modal title is "name // STATS" — first text node
            const statsTitle = document.querySelector('#statsModal .logo');
            if (statsTitle) {
                const tn = statsTitle.firstChild;
                if (tn && tn.nodeType === Node.TEXT_NODE) tn.textContent = data.username;
            }
        })
        .catch(() => alert('Could not update username.'));
    });

    // ── Change Password ──────────────────────────────────────────────────────
    ppChangePassword?.addEventListener('click', () => {
        closePopup();
        const current = prompt('Current password:');
        if (current === null) return;
        const next = prompt('New password (min 6 chars):');
        if (!next || next.length < 6) { alert('Password too short.'); return; }
        fetch('/pug/api/profile/password', {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ current, new: next })
        })
        .then(r => r.json())
        .then(data => {
            if (data.error) { alert(data.error); return; }
            alert('Password updated.');
        })
        .catch(() => alert('Could not update password.'));
    });

    // ── Delete Account ───────────────────────────────────────────────────────
    ppDeleteAccount?.addEventListener('click', () => {
        closePopup();
        if (!confirm('Delete your account? This cannot be undone.')) return;
        const password = prompt('Confirm your password to delete:');
        if (password === null) return;
        fetch('/pug/api/profile/delete', {
            method:  'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ password })
        })
        .then(r => r.json())
        .then(data => {
            if (data.error) { alert(data.error); return; }
            window.location.href = '/login';
        })
        .catch(() => alert('Could not delete account.'));
    });

    // ── Language toggle (persisted in localStorage for now) ──────────────────
    const LANG_KEY = 'pug_lang';
    const saved    = localStorage.getItem(LANG_KEY) || 'plain';

    function setLang(lang) {
        langBtns.forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
        localStorage.setItem(LANG_KEY, lang);
        document.documentElement.dataset.lang = lang;
    }

    setLang(saved);

    langBtns.forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));

});
