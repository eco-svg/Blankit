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
        // Apply translations immediately
        if (window.applyI18n) window.applyI18n(code);
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

    // ── Change Username modal ──────────────────────────────────────────────────
    const unModal       = document.getElementById('changeUsernameModal');
    const unInput       = document.getElementById('newUsernameInput');
    const unError       = document.getElementById('usernameError');
    const unCurrentSpan = document.getElementById('currentUsernameDisplay');
    const unCancelBtn   = document.getElementById('cancelUsernameBtn');
    const unConfirmBtn  = document.getElementById('confirmUsernameBtn');

    function openUnModal() {
        if (unCurrentSpan) unCurrentSpan.textContent = document.querySelector('.greeting-name')?.textContent || '';
        if (unInput)  unInput.value = '';
        if (unError)  unError.textContent = '';
        unModal?.classList.remove('hidden');
        setTimeout(() => unInput?.focus(), 60);
    }

    ppChangeUsername?.addEventListener('click', () => { closePopup(); openUnModal(); });
    unCancelBtn?.addEventListener('click', () => unModal?.classList.add('hidden'));
    window.addEventListener('click', e => { if (e.target === unModal) unModal?.classList.add('hidden'); });
    unInput?.addEventListener('keydown', e => { if (e.key === 'Enter') submitUsername(); });
    unConfirmBtn?.addEventListener('click', submitUsername);

    function submitUsername() {
        const val = unInput?.value.trim();
        if (!val) { if (unError) unError.textContent = 'Username cannot be empty.'; return; }
        if (val.length < 2) { if (unError) unError.textContent = 'At least 2 characters.'; return; }
        unConfirmBtn.disabled = true;
        fetch('/pug/api/profile/username', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: val })
        })
        .then(r => r.json())
        .then(data => {
            unConfirmBtn.disabled = false;
            if (data.error) { if (unError) unError.textContent = data.error; return; }
            unModal?.classList.add('hidden');
            const nameEl = document.querySelector('.greeting-name');
            if (nameEl) nameEl.textContent = data.username;
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
        .catch(() => { unConfirmBtn.disabled = false; if (unError) unError.textContent = 'Could not update. Try again.'; });
    }

    // ── Change Password modal ──────────────────────────────────────────────────
    const pwModal      = document.getElementById('changePasswordModal');
    const pwCurInput   = document.getElementById('currentPwInput');
    const pwNewInput   = document.getElementById('newPwInput');
    const pwError      = document.getElementById('passwordError');
    const pwCancelBtn  = document.getElementById('cancelPasswordBtn');
    const pwConfirmBtn = document.getElementById('confirmPasswordBtn');

    ppChangePassword?.addEventListener('click', () => {
        closePopup();
        if (pwCurInput) pwCurInput.value = '';
        if (pwNewInput) pwNewInput.value = '';
        if (pwError)    pwError.textContent = '';
        pwModal?.classList.remove('hidden');
        setTimeout(() => pwCurInput?.focus(), 60);
    });
    pwCancelBtn?.addEventListener('click', () => pwModal?.classList.add('hidden'));
    window.addEventListener('click', e => { if (e.target === pwModal) pwModal?.classList.add('hidden'); });
    pwNewInput?.addEventListener('keydown', e => { if (e.key === 'Enter') submitPassword(); });
    pwConfirmBtn?.addEventListener('click', submitPassword);

    function submitPassword() {
        const current = pwCurInput?.value;
        const next    = pwNewInput?.value;
        if (!current) { if (pwError) pwError.textContent = 'Enter your current password.'; return; }
        if (!next || next.length < 6) { if (pwError) pwError.textContent = 'New password needs at least 6 characters.'; return; }
        pwConfirmBtn.disabled = true;
        fetch('/pug/api/profile/password', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current, new: next })
        })
        .then(r => r.json())
        .then(data => {
            pwConfirmBtn.disabled = false;
            if (data.error) { if (pwError) pwError.textContent = data.error; return; }
            pwModal?.classList.add('hidden');
        })
        .catch(() => { pwConfirmBtn.disabled = false; if (pwError) pwError.textContent = 'Could not update. Try again.'; });
    }

    // ── Delete Account modal ───────────────────────────────────────────────────
    const delModal      = document.getElementById('deleteAccountModal');
    const delPwInput    = document.getElementById('deleteAccountPwInput');
    const delError      = document.getElementById('deleteAccountError');
    const delCancelBtn  = document.getElementById('cancelDeleteAccountBtn');
    const delConfirmBtn = document.getElementById('confirmDeleteAccountBtn');

    ppDeleteAccount?.addEventListener('click', () => {
        closePopup();
        if (delPwInput) delPwInput.value = '';
        if (delError)   delError.textContent = '';
        delModal?.classList.remove('hidden');
        setTimeout(() => delPwInput?.focus(), 60);
    });
    delCancelBtn?.addEventListener('click',  () => delModal?.classList.add('hidden'));
    window.addEventListener('click', e => { if (e.target === delModal) delModal?.classList.add('hidden'); });
    delPwInput?.addEventListener('keydown', e => { if (e.key === 'Enter') submitDelete(); });
    delConfirmBtn?.addEventListener('click', submitDelete);

    function submitDelete() {
        const pw = delPwInput?.value;
        if (!pw) { if (delError) delError.textContent = 'Password is required.'; return; }
        delConfirmBtn.disabled = true;
        fetch('/pug/api/profile/delete', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw })
        })
        .then(r => r.json())
        .then(data => {
            delConfirmBtn.disabled = false;
            if (data.error) { if (delError) delError.textContent = data.error; return; }
            window.location.href = '/login';
        })
        .catch(() => { delConfirmBtn.disabled = false; if (delError) delError.textContent = 'Could not delete. Try again.'; });
    }

});
