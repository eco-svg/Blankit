document.addEventListener('DOMContentLoaded', () => {

    const ppChangeUsername = document.getElementById('ppChangeUsername');
    const ppChangePassword = document.getElementById('ppChangePassword');
    const ppDeleteAccount  = document.getElementById('ppDeleteAccount');
    const ppChangeAvatar   = document.getElementById('ppChangeAvatar');
    const avatarFileInput  = document.getElementById('avatarFileInput');
    const profilePopup     = document.getElementById('profilePopup');
    const langBtns         = document.querySelectorAll('.pp-lang-btn');
    const statusDot        = document.getElementById('statusDot');
    const ppAppLangRow     = document.getElementById('ppAppLangRow');

    function closePopup() { profilePopup?.classList.add('hidden'); }

    // ── Avatar / PFP ────────────────────────────────────────────────────────────
    const AVATAR_KEY = 'pug_avatar';

    function applyAvatar(dataUrl) {
        const avatarEl = document.querySelector('.user-avatar');
        if (!avatarEl) return;
        avatarEl.style.backgroundImage  = `url(${dataUrl})`;
        avatarEl.style.backgroundSize   = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.classList.add('has-photo');
    }

    const savedAvatar = localStorage.getItem(AVATAR_KEY);
    if (savedAvatar) applyAvatar(savedAvatar);

    ppChangeAvatar?.addEventListener('click', e => {
        e.stopPropagation();
        avatarFileInput?.click();
    });

    avatarFileInput?.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { alert('Image too large — max 2 MB.'); return; }
        const reader = new FileReader();
        reader.onload = evt => {
            const dataUrl = evt.target.result;
            localStorage.setItem(AVATAR_KEY, dataUrl);
            applyAvatar(dataUrl);
            closePopup();
        };
        reader.readAsDataURL(file);
        e.target.value = '';   // reset so same file can be re-selected
    });

    // ── Status Dot ─────────────────────────────────────────────────────────────
    const STATUS_CYCLE = ['online', 'afk', 'offline'];
    const STATUS_LABELS = { online: 'Online', afk: 'AFK', offline: 'Offline' };
    let currentStatus = localStorage.getItem('pug_status') || 'online';

    function applyStatus(s) {
        if (!statusDot) return;
        currentStatus = s;
        statusDot.dataset.status = s;
        statusDot.title = STATUS_LABELS[s] || s;
        localStorage.setItem('pug_status', s);
    }

    applyStatus(currentStatus);

    statusDot?.addEventListener('click', e => {
        e.stopPropagation();         // don't open popup
        const idx  = STATUS_CYCLE.indexOf(currentStatus);
        const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
        applyStatus(next);
    });

    // ── App Language ───────────────────────────────────────────────────────────
    const LANG_NAMES = {
        en: 'English', hi: 'हिन्दी', es: 'Español', fr: 'Français',
        de: 'Deutsch', ja: '日本語', zh: '中文', ar: 'العربية',
        pt: 'Português', ru: 'Русский', ko: '한국어', it: 'Italiano',
        tr: 'Türkçe', nl: 'Nederlands', pl: 'Polski', bn: 'বাংলা',
    };

    function detectLangCode() {
        const raw  = navigator.language || 'en';
        const code = raw.split('-')[0].toLowerCase();
        return code;
    }

    function getLangName(code) {
        return LANG_NAMES[code] || code.toUpperCase();
    }

    const APP_LANG_KEY = 'pug_app_lang';
    const savedAppLang = localStorage.getItem(APP_LANG_KEY);
    const detectedCode = detectLangCode();

    // Build app language buttons in popup
    if (ppAppLangRow) {
        const codes = detectedCode !== 'en'
            ? ['en', detectedCode]
            : ['en'];

        codes.forEach(code => {
            const btn = document.createElement('button');
            btn.className = 'pp-lang-btn' + (savedAppLang === code || (!savedAppLang && code === 'en') ? ' active' : '');
            btn.dataset.appLang = code;
            btn.textContent = code === 'en' ? 'English' : getLangName(code);
            btn.addEventListener('click', () => setAppLang(code));
            ppAppLangRow.appendChild(btn);
        });

        // "More" placeholder for future
        if (codes.length < 2) {
            const span = document.createElement('span');
            span.style.cssText = 'font-size:0.68rem;color:var(--text-dim);padding:4px 2px;font-family:var(--font-mono);';
            span.textContent = 'English only';
            ppAppLangRow.appendChild(span);
        }
    }

    function setAppLang(code) {
        localStorage.setItem(APP_LANG_KEY, code);
        document.documentElement.lang = code === 'en' ? 'en' : code;
        document.documentElement.dataset.appLang = code;
        // Update button states
        document.querySelectorAll('[data-app-lang]').forEach(b => {
            b.classList.toggle('active', b.dataset.appLang === code);
        });
    }

    // ── First-launch language prompt ──────────────────────────────────────────
    const FIRST_LAUNCH_KEY = 'pug_lang_asked';
    if (!localStorage.getItem(FIRST_LAUNCH_KEY) && detectedCode !== 'en') {
        const welcomeModal = document.getElementById('langWelcomeModal');
        const lwSub        = document.getElementById('lwSub');
        const lwEnglish    = document.getElementById('lwEnglish');
        const lwLocal      = document.getElementById('lwLocal');

        if (welcomeModal && lwLocal) {
            lwSub.textContent  = `Would you like to use the app in ${getLangName(detectedCode)} or English?`;
            lwLocal.textContent = getLangName(detectedCode);

            welcomeModal.classList.remove('hidden');

            lwEnglish.addEventListener('click', () => {
                setAppLang('en');
                localStorage.setItem(FIRST_LAUNCH_KEY, '1');
                welcomeModal.classList.add('hidden');
            });
            lwLocal.addEventListener('click', () => {
                setAppLang(detectedCode);
                localStorage.setItem(FIRST_LAUNCH_KEY, '1');
                welcomeModal.classList.add('hidden');
            });
        }
    } else if (!localStorage.getItem(FIRST_LAUNCH_KEY)) {
        // English browser — mark as asked, default to English
        localStorage.setItem(FIRST_LAUNCH_KEY, '1');
        setAppLang('en');
    } else if (savedAppLang) {
        setAppLang(savedAppLang);
    }

    // ── Language Style toggle ──────────────────────────────────────────────────
    const STYLE_KEY = 'pug_lang';
    const savedStyle = localStorage.getItem(STYLE_KEY) || 'plain';

    function setLangStyle(lang) {
        langBtns.forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
        localStorage.setItem(STYLE_KEY, lang);
        document.documentElement.dataset.langStyle = lang;
    }

    setLangStyle(savedStyle);
    langBtns.forEach(b => b.addEventListener('click', () => setLangStyle(b.dataset.lang)));

    // ── Change Username ────────────────────────────────────────────────────────
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
            const nameEl = document.querySelector('.greeting-name');
            if (nameEl) nameEl.textContent = data.username;
            // Only update initial if no photo is set
            if (!localStorage.getItem(AVATAR_KEY)) {
                const initEl = document.querySelector('.avatar-initial');
                if (initEl) initEl.textContent = data.username[0].toUpperCase();
            }
            const statsTitle = document.querySelector('#statsModal .logo');
            if (statsTitle) {
                const tn = statsTitle.firstChild;
                if (tn && tn.nodeType === Node.TEXT_NODE) tn.textContent = data.username;
            }
        })
        .catch(() => alert('Could not update username.'));
    });

    // ── Change Password ────────────────────────────────────────────────────────
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

    // ── Delete Account ─────────────────────────────────────────────────────────
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

});
