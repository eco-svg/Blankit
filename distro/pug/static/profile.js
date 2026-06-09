// Apply saved palette immediately on script load (prevents flash of wrong theme)
(function() {
    const VALID = ['dark', 'astro', 'red', 'gold'];
    const p = localStorage.getItem('veyra-pug-palette');
    if (p && !VALID.includes(p)) { localStorage.removeItem('veyra-pug-palette'); return; }
    if (p && p !== 'dark') document.documentElement.setAttribute('data-theme', p);
})();

// ── Mobile custom select picker ───────────────────────────────────────────────
function initMobSelects() {
    if (window.innerWidth > 768) return;
    document.querySelectorAll('.mob-select-wrap').forEach(wrap => {
        const sel = wrap.querySelector('select');
        const btn = wrap.querySelector('.mob-sel-btn');
        const valSpan = wrap.querySelector('.mob-sel-val');
        if (!sel || !btn) return;

        function syncLabel() {
            const opt = sel.options[sel.selectedIndex];
            if (opt && valSpan) valSpan.textContent = opt.text;
        }
        syncLabel();

        btn.addEventListener('click', () => {
            const overlay = document.createElement('div');
            overlay.className = 'mob-picker-overlay';
            const sheet = document.createElement('div');
            sheet.className = 'mob-picker-sheet';
            sheet.innerHTML = '<div class="mob-picker-handle"></div>';

            Array.from(sel.options).forEach(opt => {
                const row = document.createElement('button');
                row.className = 'mob-picker-row' + (opt.value === sel.value ? ' active' : '');
                row.type = 'button';
                row.textContent = opt.text;
                row.addEventListener('click', () => {
                    sel.value = opt.value;
                    sel.dispatchEvent(new Event('change'));
                    syncLabel();
                    document.body.removeChild(overlay);
                });
                sheet.appendChild(row);
            });

            overlay.appendChild(sheet);
            document.body.appendChild(overlay);
            overlay.addEventListener('click', e => {
                if (e.target === overlay) document.body.removeChild(overlay);
            });
        });
    });
}

/* ── Starfield canvas ── */
let _starCanvas = null;
function _startStarfield() {
    const bg = document.querySelector('.pug-bg');
    if (!bg) return;
    _stopStarfield();
    const canvas = document.createElement('canvas');
    canvas.id = 'veyraStarCanvas';
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    bg.appendChild(canvas);
    _starCanvas = canvas;
    const ctx = canvas.getContext('2d');
    const stars = Array.from({ length: 220 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() > 0.85 ? 1.5 : 0.8,
        a: 0.3 + Math.random() * 0.7,
        da: (Math.random() * 0.004 + 0.001) * (Math.random() > 0.5 ? 1 : -1),
    }));
    function draw() {
        if (!_starCanvas) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        stars.forEach(s => {
            s.a += s.da;
            if (s.a > 1 || s.a < 0.2) s.da *= -1;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${s.a.toFixed(2)})`;
            ctx.fill();
        });
        requestAnimationFrame(draw);
    }
    draw();
}
function _stopStarfield() {
    if (_starCanvas) { _starCanvas.remove(); _starCanvas = null; }
}

function applyPalette(name) {
    if (!name || name === 'dark') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', name);
    }
}

function applyWallpaper(name) {
    _stopStarfield();
    document.documentElement.setAttribute('data-wallpaper', name || 'default');
    if (name === 'starfield') _startStarfield();
}

function initThemeSwatches() {
    // Color palette (full theme swap)
    const VALID_PALETTES = ['dark', 'astro', 'red', 'gold'];
    const raw = localStorage.getItem('veyra-pug-palette') || 'dark';
    const savedPalette = VALID_PALETTES.includes(raw) ? raw : 'dark';
    if (!VALID_PALETTES.includes(raw)) localStorage.removeItem('veyra-pug-palette');
    applyPalette(savedPalette);
    document.querySelectorAll('.palette-swatch').forEach(btn => {
        if (btn.dataset.palette === savedPalette) btn.classList.add('theme-swatch-active');
        btn.addEventListener('click', () => {
            const p = btn.dataset.palette;
            localStorage.setItem('veyra-pug-palette', p);
            applyPalette(p);
            document.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('theme-swatch-active'));
            btn.classList.add('theme-swatch-active');
        });
    });

    // Wallpaper (background)
    const savedWp = localStorage.getItem('veyra-pug-wallpaper') || 'default';
    applyWallpaper(savedWp);
    document.querySelectorAll('.wallpaper-swatch').forEach(btn => {
        if (btn.dataset.wallpaper === savedWp) btn.classList.add('theme-swatch-active');
        btn.addEventListener('click', () => {
            const wp = btn.dataset.wallpaper;
            localStorage.setItem('veyra-pug-wallpaper', wp);
            applyWallpaper(wp);
            document.querySelectorAll('.wallpaper-swatch').forEach(s => s.classList.remove('theme-swatch-active'));
            btn.classList.add('theme-swatch-active');
        });
    });

    // Filter (CSS filter on background — independent of wallpaper)
    const savedFilter = localStorage.getItem('veyra-pug-filter') || 'default';
    if (savedFilter !== 'default') document.documentElement.setAttribute('data-filter', savedFilter);
    document.querySelectorAll('.filter-swatch').forEach(btn => {
        if (btn.dataset.filter === savedFilter) btn.classList.add('theme-swatch-active');
        btn.addEventListener('click', () => {
            const f = btn.dataset.filter;
            localStorage.setItem('veyra-pug-filter', f);
            if (f === 'default') {
                document.documentElement.removeAttribute('data-filter');
            } else {
                document.documentElement.setAttribute('data-filter', f);
            }
            document.querySelectorAll('.filter-swatch').forEach(s => s.classList.remove('theme-swatch-active'));
            btn.classList.add('theme-swatch-active');
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {

    initThemeSwatches();

    const ppChangeUsername  = document.getElementById('ppChangeUsername');
    const ppChangePassword  = document.getElementById('ppChangePassword');
    const ppDeleteAccount   = document.getElementById('ppDeleteAccount');
    const ppChangeAvatar    = document.getElementById('ppChangeAvatar');
    const avatarFileInput   = document.getElementById('avatarFileInput');
    const profilePopup      = document.getElementById('profilePopup');
    const statusDot         = document.getElementById('statusDot');
    const ppAppLangSelect   = document.getElementById('ppAppLangSelect');
    const ppHomeTabSelect   = document.getElementById('ppHomeTabSelect');

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

    function setAppLang(code) {
        localStorage.setItem(APP_LANG_KEY, code);
        document.documentElement.lang = code === 'en' ? 'en' : code;
        document.documentElement.dataset.appLang = code;
        if (ppAppLangSelect) ppAppLangSelect.value = code;
        if (window.applyI18n) window.applyI18n(code);
    }

    if (ppAppLangSelect) {
        ppAppLangSelect.value = savedAppLang || 'en';
        ppAppLangSelect.addEventListener('change', () => setAppLang(ppAppLangSelect.value));
    }

    // ── Home Tab setting ─────────────────────────────────────────────────────
    if (ppHomeTabSelect) {
        const savedHome = localStorage.getItem('veyra_home_tab') || 'notes';
        ppHomeTabSelect.value = savedHome;
        ppHomeTabSelect.addEventListener('change', () => {
            if (window._veyraSetHomeTab) window._veyraSetHomeTab(ppHomeTabSelect.value);
        });
    }

    initMobSelects();

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

    // ── What's Coming first-visit popup ──────────────────────────────────────
    const WN_KEY       = 'veyra_whatsnew_seen';
    const wnModal      = document.getElementById('whatsNewModal');
    const wnDismissBtn = document.getElementById('whatsNewDismiss');
    if (wnModal && !localStorage.getItem(WN_KEY)) {
        setTimeout(() => wnModal.classList.remove('hidden'), 600);
        wnDismissBtn?.addEventListener('click', () => {
            wnModal.classList.add('hidden');
            localStorage.setItem(WN_KEY, '1');
        });
    }

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

    // ── Student Verification ───────────────────────────────────────────────────
    const ppStudentVerify = document.getElementById('ppStudentVerify');
    const ppStudentLabel  = document.getElementById('ppStudentLabel');
    const svModal         = document.getElementById('studentVerifyModal');
    const svIdFile        = document.getElementById('svIdFile');
    const svStatusEl      = document.getElementById('svStatus');
    const svSubmitBtn     = document.getElementById('svSubmitBtn');
    const svCancelBtn     = document.getElementById('svCancelBtn');

    function showSvStatus(msg, ok) {
        if (!svStatusEl) return;
        svStatusEl.textContent  = msg;
        svStatusEl.style.display    = 'block';
        svStatusEl.style.background = ok ? 'rgba(80,200,80,0.1)' : 'rgba(200,80,80,0.1)';
        svStatusEl.style.color      = ok ? '#8fca8f' : '#e87070';
        svStatusEl.style.border     = ok ? '1px solid rgba(80,200,80,0.3)' : '1px solid rgba(200,80,80,0.3)';
    }

    function updateStudentLabel(status) {
        if (!ppStudentLabel) return;
        const map = {
            none:     'Verify Student Status',
            pending:  '⏳ Verification Pending',
            approved: '✦ Student Verified',
            rejected: 'Re-submit Verification',
        };
        ppStudentLabel.textContent = map[status] || 'Verify Student Status';
    }

    fetch('/auth/student-status')
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) updateStudentLabel(data.status); })
        .catch(() => {});

    ppStudentVerify?.addEventListener('click', () => {
        closePopup();
        if (svStatusEl) {
            svStatusEl.style.display = 'block';
            svStatusEl.style.background = 'rgba(232,184,75,0.08)';
            svStatusEl.style.color = 'var(--accent)';
            svStatusEl.textContent = '✦ Student verification — coming soon.';
        }
        if (svSubmitBtn) svSubmitBtn.disabled = true;
        svModal?.classList.remove('hidden');
    });

    svCancelBtn?.addEventListener('click', () => svModal?.classList.add('hidden'));
    window.addEventListener('click', e => { if (e.target === svModal) svModal?.classList.add('hidden'); });

    /* ID upload submit — commented out until verification flow is finalised
    svSubmitBtn?.addEventListener('click', async () => {
        const file = svIdFile?.files?.[0];
        if (!file) { showSvStatus('Please select your student ID image.', false); return; }
        svSubmitBtn.disabled    = true;
        svSubmitBtn.textContent = 'Uploading…';
        try {
            const fd = new FormData();
            fd.append('id_image', file);
            const res  = await fetch('/auth/student-verify', { method: 'POST', body: fd });
            const data = await res.json();
            if (res.ok) {
                showSvStatus('✓ Submitted — we\'ll review and email you within 24h.', true);
                updateStudentLabel('pending');
            } else {
                showSvStatus(data.error || 'Submission failed. Try again.', false);
                svSubmitBtn.disabled = false;
            }
        } catch {
            showSvStatus('Network error. Try again.', false);
            svSubmitBtn.disabled = false;
        }
        svSubmitBtn.textContent = 'Submit for review';
    });
    */

});
