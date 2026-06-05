/* ═══════════════════════════════════════
   login.js — VEYRA auth
═══════════════════════════════════════ */

/* ══════════════════════════════
   DISTRO DATA
══════════════════════════════ */
const DISTROS = {
  'Eco-Svg':   { maintainer: 'Eco-Svg',  focus: 'habit tracking + AI insights', status: '● active', about: '— to be filled —' },
  'CatalystCrew': { maintainer: 'CatalystCrew', focus: '— to be filled —',             status: '● active', about: '— to be filled —' },
  'Ocellus':   { maintainer: 'Ocellus',   focus: '— to be filled —',             status: '● active', about: '— to be filled —' },
};
const DISTRO_KEYS = ['Eco-Svg', 'CatalystCrew', 'Ocellus'];
const BG_IDS      = { 'Eco-Svg': 'bg-Eco-Svg', 'CatalystCrew': 'bg-CatalystCrew', 'Ocellus': 'bg-Ocellus' };

// Where each distro lands after login/register
const DISTRO_REDIRECTS = {
  'Eco-Svg':   '/home',
  'CatalystCrew': '/d/home',
  'Ocellus':   '/pug/home',
};

/* ══════════════════════════════
   STATE
══════════════════════════════ */
let currentIndex = 0;
let isLocked     = false;
let lockedDistro = null;

// Track which distro the OTP was sent for so we redirect correctly after verify
let pendingDistro = null;

/* ══════════════════════════════
   TERMINAL TYPEWRITER
══════════════════════════════ */
const termCmd = document.getElementById('termCmd');
function typeCmd(text) {
  termCmd.textContent = '';
  let i = 0;
  const iv = setInterval(() => {
    termCmd.textContent += text[i];
    i++;
    if (i >= text.length) clearInterval(iv);
  }, 38);
}
typeCmd('select_distro --interactive');

/* ══════════════════════════════
   BACKGROUND SWITCHER
══════════════════════════════ */
function switchBg(distro) {
  document.querySelectorAll('.bg-layer').forEach(l => l.classList.remove('active'));
  const el = document.getElementById(BG_IDS[distro]);
  if (el) el.classList.add('active');
}

/* ══════════════════════════════
   SWIPER
══════════════════════════════ */
const cards  = document.querySelectorAll('.distro-card');
const dots   = document.querySelectorAll('.s-dot');
const arrowL = document.getElementById('arrowLeft');
const arrowR = document.getElementById('arrowRight');

function showCard(index, direction = 1) {
  const current = document.querySelector('.distro-card.active');
  const next    = cards[index];
  if (current === next) return;

  current.classList.remove('active');
  current.style.transform = direction > 0 ? 'translateX(-60px)' : 'translateX(60px)';
  current.style.opacity   = '0';

  next.style.transform = direction > 0 ? 'translateX(60px)' : 'translateX(-60px)';
  next.style.opacity   = '0';
  next.style.transition = 'none';

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      next.style.transition = '';
      next.classList.add('active');
      next.style.transform  = 'translateX(0)';
      next.style.opacity    = '1';
    });
  });

  setTimeout(() => {
    current.style.transform = '';
    current.style.opacity   = '';
  }, 300);

  dots.forEach((d, i) => d.classList.toggle('active', i === index));
  currentIndex = index;
  const key = DISTRO_KEYS[index];
  updateDistroInfo(key);
  updateDistroLabels(key);
  document.documentElement.setAttribute('data-distro', key);
  switchBg(key);
  typeCmd(`distro --select=${key}`);
  updateArrows();
}

function updateArrows() {
  arrowL.disabled = isLocked || currentIndex === 0;
  arrowR.disabled = isLocked || currentIndex === DISTRO_KEYS.length - 1;
}

arrowL.addEventListener('click', () => {
  if (!isLocked && currentIndex > 0) showCard(currentIndex - 1, -1);
});
arrowR.addEventListener('click', () => {
  if (!isLocked && currentIndex < DISTRO_KEYS.length - 1) showCard(currentIndex + 1, 1);
});
dots.forEach(dot => {
  dot.addEventListener('click', () => {
    if (isLocked) return;
    const idx = parseInt(dot.dataset.index);
    if (idx !== currentIndex) showCard(idx, idx > currentIndex ? 1 : -1);
  });
});

/* touch / swipe */
let touchStartX = 0;
const swiper = document.getElementById('swiper');
swiper.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
swiper.addEventListener('touchend', e => {
  if (isLocked) return;
  const diff = touchStartX - e.changedTouches[0].clientX;
  if (Math.abs(diff) < 40) return;
  if (diff > 0 && currentIndex < DISTRO_KEYS.length - 1) showCard(currentIndex + 1, 1);
  if (diff < 0 && currentIndex > 0)                       showCard(currentIndex - 1, -1);
});

updateArrows();

/* ══════════════════════════════
   DISTRO INFO
══════════════════════════════ */
function updateDistroInfo(distro) {
  const d = DISTROS[distro];
  document.getElementById('infoMaintainer').textContent = d.maintainer;
  document.getElementById('infoFocus').textContent      = d.focus;
  document.getElementById('infoStatus').textContent     = d.status;
  document.getElementById('infoAbout').textContent      = d.about;
}

function updateDistroLabels(distro) {
  document.getElementById('loginDistroLabel').textContent    = distro;
  document.getElementById('registerDistroLabel').textContent = distro;
  const mcd = document.getElementById('mobileConDistro');
  if (mcd) mcd.textContent = distro;
}

/* ══════════════════════════════
   DISTRO LOCK
══════════════════════════════ */
function lockDistro(distro) {
  isLocked     = true;
  lockedDistro = distro;
  arrowL.style.display = 'none';
  arrowR.style.display = 'none';
  dots.forEach(d => { d.style.pointerEvents = 'none'; d.style.opacity = '0.25'; });
  document.getElementById('lockedBar').classList.remove('hidden');
  document.getElementById('lockedName').textContent = distro;
  typeCmd(`distro --locked=${distro}`);
}

const savedLocked = localStorage.getItem('veyra-locked-distro');
if (savedLocked && DISTRO_KEYS.includes(savedLocked)) {
  const idx = DISTRO_KEYS.indexOf(savedLocked);
  showCard(idx, 1);
  lockDistro(savedLocked);
}

/* ══════════════════════════════
   MOBILE TWO-STEP FLOW
══════════════════════════════ */
(function () {
  const conBtn  = document.getElementById('mobileConBtn');
  const backBtn = document.getElementById('mobileBackBtn');
  const main    = document.querySelector('.main');
  if (!conBtn || !backBtn || !main) return;

  // Locked users skip straight to auth on mobile
  if (isLocked) main.classList.add('step-auth');

  conBtn.addEventListener('click', function () {
    main.classList.add('step-auth');
    typeCmd(`auth --mode=login distro=${DISTRO_KEYS[currentIndex]}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  backBtn.addEventListener('click', function () {
    main.classList.remove('step-auth');
    typeCmd('select_distro --interactive');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

/* ══════════════════════════════
   TAB SWITCHER
══════════════════════════════ */
const tabs    = document.querySelectorAll('.tab');
const tabLine = document.getElementById('tabLine');

function switchTab(name) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`panel-${name}`);
  if (panel) panel.classList.add('active');
  positionTabLine(name);
  clearAllErrors();
  typeCmd(`auth --mode=${name}`);

  const infoPanel = document.getElementById('distroInfoPanel');
  const ageCard   = document.getElementById('ageVerifyCard');
  if (infoPanel && ageCard) {
    const reg = name === 'register';
    infoPanel.style.display = reg ? 'none' : '';
    ageCard.style.display   = reg ? ''     : 'none';
  }
}

function positionTabLine(name) {
  const tab = document.querySelector(`.tab[data-tab="${name}"]`);
  if (!tab) return;
  const pr = document.querySelector('.tabs').getBoundingClientRect();
  const tr = tab.getBoundingClientRect();
  tabLine.style.left  = (tr.left - pr.left) + 'px';
  tabLine.style.width = tr.width + 'px';
}

tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
document.querySelectorAll('[data-tab]').forEach(el => {
  if (el.classList.contains('tab')) return;
  el.addEventListener('click', () => switchTab(el.dataset.tab));
});

(function(){
  var regBtn      = document.getElementById('registerBtn');
  var dobInput    = document.getElementById('regDob');
  var dobInline   = document.getElementById('regDobInline');
  if (!regBtn) return;

  function formatDob(input) {
    input.addEventListener('input', function() {
      var raw = this.value.replace(/\D/g, '').substring(0, 8);
      var out = '';
      if (raw.length > 0) out = raw.substring(0, 2);
      if (raw.length > 2) out += ' / ' + raw.substring(2, 4);
      if (raw.length > 4) out += ' / ' + raw.substring(4, 8);
      this.value = out;
      checkDob();
    });
  }
  if (dobInput)  formatDob(dobInput);
  if (dobInline) formatDob(dobInline);

  function checkDob() {
    var active = (window.innerWidth <= 700 && dobInline) ? dobInline : dobInput;
    if (!active) return;
    var raw = active.value.replace(/\D/g, '');
    if (raw.length < 8) { regBtn.style.opacity = '0.4'; regBtn.style.pointerEvents = 'none'; return; }
    var m = parseInt(raw.substring(0, 2), 10);
    var d = parseInt(raw.substring(2, 4), 10);
    var y = parseInt(raw.substring(4, 8), 10);
    if (!m || m > 12 || !d || d > 31 || y < 1904 || y > 2099) { regBtn.style.opacity = '0.4'; regBtn.style.pointerEvents = 'none'; return; }
    var today = new Date(), born = new Date(y, m - 1, d);
    var age = today.getFullYear() - born.getFullYear() - ((today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) ? 1 : 0);
    var ok = age >= 13 && age <= 120;
    regBtn.style.opacity = ok ? '' : '0.4';
    regBtn.style.pointerEvents = ok ? '' : 'none';
  }
  checkDob();
})();
setTimeout(() => positionTabLine('login'), 60);
window.addEventListener('resize', () => {
  const active = document.querySelector('.tab.active');
  if (active) positionTabLine(active.dataset.tab);
});

/* ══════════════════════════════
   LOGIN METHOD TOGGLE
══════════════════════════════ */
let loginMethod = 'email';
document.querySelectorAll('.method-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loginMethod = btn.dataset.method;
    const input = document.getElementById('loginIdentifier');
    const label = document.getElementById('loginIdentifierLabel');
    if (loginMethod === 'email') {
      input.type = 'email'; input.placeholder = 'you@example.com';
      label.textContent = '// email';
    } else {
      input.type = 'text'; input.placeholder = 'your_handle';
      label.textContent = '// username';
    }
    input.value = '';
  });
});

/* ══════════════════════════════
   PASSWORD SHOW / HIDE
══════════════════════════════ */
document.querySelectorAll('.eye-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    const shown = input.type === 'text';
    input.type      = shown ? 'password' : 'text';
    btn.textContent = shown ? 'show' : 'hide';
  });
});

/* ══════════════════════════════
   PASSWORD STRENGTH
══════════════════════════════ */
document.getElementById('regPassword').addEventListener('input', function () {
  const pw = this.value;
  let score = 0;
  if (pw.length >= 8)          score++;
  if (pw.length >= 12)         score++;
  if (/[A-Z]/.test(pw))        score++;
  if (/[0-9]/.test(pw))        score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const pct    = pw.length ? Math.min((score / 5) * 100, 100) : 0;
  const colors = ['#ff5252', '#ff5252', '#ffc14d', '#39ff14', '#22cc00'];
  const labels = ['', 'weak', 'fair', 'good', 'strong', 'max'];
  document.getElementById('strengthFill').style.width      = pct + '%';
  document.getElementById('strengthFill').style.background = colors[Math.min(score - 1, 4)] || 'transparent';
  document.getElementById('strengthLabel').textContent     = pw.length ? (labels[score] || 'max') : '—';
});

/* ══════════════════════════════
   VALIDATION HELPERS
══════════════════════════════ */
function setErr(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}
function clearAllErrors() {
  document.querySelectorAll('.field-err').forEach(e => e.textContent = '');
  document.querySelectorAll('.field-input').forEach(i => i.classList.remove('error'));
  document.querySelectorAll('.flash').forEach(f => f.classList.add('hidden'));
}
function showFlash(id, msg, type = 'error') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className   = `flash ${type}`;
  el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 4000);
}
function setLoading(btnId, loaderId, on) {
  document.getElementById(btnId).disabled = on;
  document.getElementById(loaderId).classList.toggle('hidden', !on);
}
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function getCurrentDistro() { return DISTRO_KEYS[currentIndex]; }

/* ══════════════════════════════
   LOGIN
══════════════════════════════ */
document.getElementById('loginBtn').addEventListener('click', async () => {
  clearAllErrors();
  const identifier = document.getElementById('loginIdentifier').value.trim();
  const password   = document.getElementById('loginPassword').value;
  let ok = true;

  if (!identifier) { setErr('loginIdentifierErr', `${loginMethod} required`); ok = false; }
  else if (loginMethod === 'email' && !validEmail(identifier)) {
    setErr('loginIdentifierErr', 'invalid email'); ok = false;
  }
  if (!password) { setErr('loginPasswordErr', 'password required'); ok = false; }
  if (!ok) return;

  setLoading('loginBtn', 'loginLoader', true);
  typeCmd('auth --processing...');

  try {
    const res  = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier,
        method:   loginMethod,
        password,
        remember: document.getElementById('rememberMe').checked,
        distro:   getCurrentDistro(),
      }),
    });
    const data = await res.json();

    if (res.ok && data.redirect) {
      // Lock to the distro the server confirmed (from DB)
      const confirmedDistro = data.distro || getCurrentDistro();
      localStorage.setItem('veyra-locked-distro', confirmedDistro);
      lockDistro(confirmedDistro);
      showFlash('loginFlash', '✓ authenticated. redirecting...', 'success');
      typeCmd(`auth --success redirect=${data.redirect}`);
      setTimeout(() => window.location.href = data.redirect, 900);

    } else if (res.status === 403 && data.error === 'email_not_verified') {
      pendingDistro = getCurrentDistro();
      showOtpPanel(data.email);
      typeCmd('auth --verify-otp');

    } else {
      showFlash('loginFlash', data.error || 'invalid credentials');
      typeCmd('auth --error: invalid credentials');
    }
  } catch {
    showFlash('loginFlash', 'network error');
    typeCmd('auth --error: network failure');
  } finally {
    setLoading('loginBtn', 'loginLoader', false);
  }
});

/* ══════════════════════════════
   REGISTER
══════════════════════════════ */
document.getElementById('registerBtn').addEventListener('click', async () => {
  clearAllErrors();
  const username = document.getElementById('regUsername').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm  = document.getElementById('regConfirm').value;
  const dobEl    = (window.innerWidth <= 700 && document.getElementById('regDobInline')) ? document.getElementById('regDobInline') : document.getElementById('regDob');
  const dobErrId = (window.innerWidth <= 700 && document.getElementById('regAgeErrInline')) ? 'regAgeErrInline' : 'regAgeErr';
  const dobRaw   = (dobEl?.value || '').replace(/\D/g, '');
  const dobMonth = parseInt(dobRaw.substring(0, 2), 10);
  const dobDay   = parseInt(dobRaw.substring(2, 4), 10);
  const dobYear  = parseInt(dobRaw.substring(4, 8), 10);
  const termsOk  = document.getElementById('regTermsCheck')?.checked;
  const ageOk    = document.getElementById('regAgeCheck')?.checked;
  let ok = true;

  if (!username || username.length < 3)        { setErr('regUsernameErr', 'min 3 chars'); ok = false; }
  else if (!/^[a-zA-Z0-9_]+$/.test(username))  { setErr('regUsernameErr', 'a-z 0-9 _ only'); ok = false; }
  if (!validEmail(email))                       { setErr('regEmailErr', 'invalid email'); ok = false; }
  if (!password || password.length < 8)         { setErr('regPasswordErr', 'min 8 chars'); ok = false; }
  if (password !== confirm)                     { setErr('regConfirmErr', 'passwords do not match'); ok = false; }

  if (dobRaw.length < 8 || !dobMonth || dobMonth > 12 || !dobDay || dobDay > 31 || dobYear < 1904 || dobYear > 2099) {
    setErr(dobErrId, 'please enter your date of birth'); ok = false;
  } else {
    const born  = new Date(dobYear, dobMonth - 1, dobDay);
    const today = new Date();
    const computedAge = today.getFullYear() - born.getFullYear() - ((today.getMonth() + 1 < dobMonth || (today.getMonth() + 1 === dobMonth && today.getDate() < dobDay)) ? 1 : 0);
    if (computedAge < 13) {
      window.location.href = '/under13'; return;
    }
    if (computedAge > 120) { setErr(dobErrId, 'please enter a valid date of birth'); ok = false; }
  }

  if (!termsOk || !ageOk) { setErr('regConsentErr', 'please confirm both checkboxes to continue'); ok = false; }
  if (!ok) return;

  setLoading('registerBtn', 'registerLoader', true);
  typeCmd('auth --register --processing...');

  try {
    const distro = getCurrentDistro();
    const res    = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, distro, dob: `${dobYear}-${String(dobMonth).padStart(2,'0')}-${String(dobDay).padStart(2,'0')}` }),
    });
    const data = await res.json();

    if (res.ok && data.message === 'otp_sent') {
      pendingDistro = distro;
      showOtpPanel(data.email);
      typeCmd('auth --register --otp-sent');
    } else if (data.error === 'under_13') {
      window.location.href = '/under13';
    } else {
      showFlash('registerFlash', data.error || 'registration failed');
      typeCmd('auth --register --error');
    }
  } catch {
    showFlash('registerFlash', 'network error');
  } finally {
    setLoading('registerBtn', 'registerLoader', false);
  }
});

/* ══════════════════════════════
   FORGOT PASSWORD
══════════════════════════════ */
document.getElementById('forgotBtn').addEventListener('click', async () => {
  clearAllErrors();
  const email = document.getElementById('forgotEmail').value.trim();
  if (!validEmail(email)) { setErr('forgotEmailErr', 'invalid email'); return; }

  setLoading('forgotBtn', 'forgotLoader', true);
  typeCmd('auth --send-reset-link...');

  try {
    const res  = await fetch('/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    showFlash(
      'forgotFlash',
      res.ok ? '✓ reset link sent — check inbox' : data.error || 'error',
      res.ok ? 'success' : 'error'
    );
    typeCmd(res.ok ? 'auth --reset-link sent' : 'auth --error');
  } catch {
    showFlash('forgotFlash', 'network error');
  } finally {
    setLoading('forgotBtn', 'forgotLoader', false);
  }
});

/* ══════════════════════════════
   ENTER KEY
══════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const active = document.querySelector('.panel.active');
  if (!active) return;
  const map = { 'panel-login': 'loginBtn', 'panel-register': 'registerBtn', 'panel-forgot': 'forgotBtn', 'panel-reset': 'resetSubmitBtn' };
  const btnId = map[active.id];
  const btnEl = btnId && document.getElementById(btnId);
  if (btnEl) btnEl.click();
});

/* ══════════════════════════════
   RESET PASSWORD (token from email link)
══════════════════════════════ */
(function checkResetToken() {
  const params     = new URLSearchParams(window.location.search);
  const resetToken = params.get('reset_token');
  if (!resetToken) return;
  history.replaceState({}, '', window.location.pathname);
  showResetPanel(resetToken);
})();

(function checkKicked() {
  const params = new URLSearchParams(window.location.search);
  if (!params.get('kicked')) return;
  history.replaceState({}, '', window.location.pathname);
  showFlash('loginFlash', 'Your session was ended — this account no longer exists.', 'error');
})();

function showResetPanel(token) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

  let panel = document.getElementById('panel-reset');
  if (!panel) {
    panel = document.createElement('div');
    panel.id        = 'panel-reset';
    panel.className = 'panel active';
    panel.innerHTML = `
      <p style="font-size:0.7rem;color:var(--text3);letter-spacing:0.04em;line-height:1.6">
        Enter your new password below.
      </p>
      <div class="field">
        <label class="field-label">// new_password</label>
        <div class="input-row">
          <input class="field-input" type="password" id="resetPassword"
                 placeholder="min 8 characters" autocomplete="new-password"/>
          <button class="eye-btn" data-target="resetPassword">show</button>
        </div>
        <span class="field-err" id="resetPasswordErr"></span>
      </div>
      <div class="field">
        <label class="field-label">// confirm_password</label>
        <div class="input-row">
          <input class="field-input" type="password" id="resetConfirm"
                 placeholder="••••••••" autocomplete="new-password"/>
          <button class="eye-btn" data-target="resetConfirm">show</button>
        </div>
        <span class="field-err" id="resetConfirmErr"></span>
      </div>
      <button class="submit-btn" id="resetSubmitBtn">
        $ reset --password
        <span class="btn-loader hidden" id="resetLoader"></span>
      </button>
      <div class="flash hidden" id="resetFlash"></div>
    `;
    document.querySelector('.auth-card').appendChild(panel);
    panel.querySelectorAll('.eye-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = document.getElementById(btn.dataset.target);
        const vis = inp.type === 'text';
        inp.type = vis ? 'password' : 'text';
        btn.textContent = vis ? 'show' : 'hide';
      });
    });
  } else {
    panel.classList.add('active');
  }

  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tabLine').style.width = '0';
  typeCmd('auth --reset-password');

  const doReset = () => submitReset(token);
  document.getElementById('resetSubmitBtn').onclick              = doReset;
  document.getElementById('resetPassword').onkeydown             = e => { if (e.key === 'Enter') doReset(); };
  document.getElementById('resetConfirm').onkeydown              = e => { if (e.key === 'Enter') doReset(); };
}

async function submitReset(token) {
  const password = document.getElementById('resetPassword').value;
  const confirm  = document.getElementById('resetConfirm').value;
  document.getElementById('resetPasswordErr').textContent = '';
  document.getElementById('resetConfirmErr').textContent  = '';

  if (!password || password.length < 8) { document.getElementById('resetPasswordErr').textContent = 'min 8 chars'; return; }
  if (password !== confirm)             { document.getElementById('resetConfirmErr').textContent  = 'passwords do not match'; return; }

  document.getElementById('resetSubmitBtn').disabled = true;
  document.getElementById('resetLoader').classList.remove('hidden');
  typeCmd('auth --reset-password...');

  try {
    const res  = await fetch('/auth/reset-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, new_password: password }),
    });
    const data = await res.json();
    if (res.ok) {
      showFlash('resetFlash', '✓ password updated — sign in with your new password', 'success');
      typeCmd('auth --reset-success');
      setTimeout(() => switchTab('login'), 2500);
    } else {
      showFlash('resetFlash', data.error || 'reset failed');
      typeCmd('auth --reset-error');
    }
  } catch {
    showFlash('resetFlash', 'network error');
  } finally {
    document.getElementById('resetSubmitBtn').disabled = false;
    document.getElementById('resetLoader').classList.add('hidden');
  }
}

/* ══════════════════════════════
   OTP PANEL
══════════════════════════════ */
function showOtpPanel(email) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

  let otpPanel = document.getElementById('panel-otp');
  if (!otpPanel) {
    otpPanel = document.createElement('div');
    otpPanel.id        = 'panel-otp';
    otpPanel.className = 'panel active';
    otpPanel.innerHTML = `
      <p style="font-size:0.7rem;color:var(--text3);letter-spacing:0.04em;line-height:1.6">
        A 6-digit code was sent to<br>
        <strong style="color:var(--accent)" id="otpEmailDisplay"></strong>
      </p>
      <div class="field">
        <label class="field-label">// verification_code</label>
        <input class="field-input" type="text" id="otpInput"
               placeholder="______" maxlength="6"
               style="font-size:1.4rem;letter-spacing:0.4em;text-align:center"/>
        <span class="field-err" id="otpErr"></span>
      </div>
      <button class="submit-btn" id="otpSubmitBtn">
        $ verify --otp
        <span class="btn-loader hidden" id="otpLoader"></span>
      </button>
      <div class="flash hidden" id="otpFlash"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:0.25rem">
        <button class="link-btn" id="otpResendBtn">Resend code</button>
        <span id="otpTimer" style="font-size:0.62rem;color:var(--text3)"></span>
      </div>
    `;
    document.querySelector('.auth-card').appendChild(otpPanel);
  } else {
    otpPanel.classList.add('active');
  }

  const emailDisplay = document.getElementById('otpEmailDisplay');
  if (emailDisplay) emailDisplay.textContent = email;

  document.getElementById('otpInput').value        = '';
  document.getElementById('otpErr').textContent    = '';
  document.getElementById('otpFlash').classList.add('hidden');

  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tabLine').style.width = '0';

  typeCmd('auth --enter-otp');
  startOtpTimer();

  document.getElementById('otpSubmitBtn').onclick   = submitOtp;
  document.getElementById('otpInput').onkeydown     = e => { if (e.key === 'Enter') submitOtp(); };
  document.getElementById('otpInput').oninput       = function () {
    this.value = this.value.replace(/[^0-9]/g, '');
    if (this.value.length === 6) submitOtp();
  };

  document.getElementById('otpResendBtn').onclick = async () => {
    try {
      const res  = await fetch('/auth/resend-otp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      });
      const data = await res.json();
      const flash = document.getElementById('otpFlash');
      flash.textContent = res.ok ? '✓ new code sent — check your inbox' : data.error;
      flash.className   = `flash ${res.ok ? 'success' : 'error'}`;
      flash.classList.remove('hidden');
      if (res.ok) startOtpTimer();
    } catch {
      const flash = document.getElementById('otpFlash');
      flash.textContent = 'network error';
      flash.className   = 'flash error';
      flash.classList.remove('hidden');
    }
  };
}

let otpTimerInterval = null;
function startOtpTimer() {
  if (otpTimerInterval) clearInterval(otpTimerInterval);
  let seconds = 600;
  const timerEl = document.getElementById('otpTimer');
  if (!timerEl) return;
  function tick() {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    timerEl.textContent = `expires in ${m}:${String(s).padStart(2, '0')}`;
    if (seconds <= 0) {
      clearInterval(otpTimerInterval);
      timerEl.textContent = 'code expired';
      timerEl.style.color = 'var(--err)';
    }
    seconds--;
  }
  tick();
  otpTimerInterval = setInterval(tick, 1000);
}

async function submitOtp() {
  const otp   = document.getElementById('otpInput').value.trim();
  const errEl = document.getElementById('otpErr');
  errEl.textContent = '';

  if (otp.length !== 6) { errEl.textContent = 'enter all 6 digits'; return; }

  document.getElementById('otpSubmitBtn').disabled = true;
  document.getElementById('otpLoader').classList.remove('hidden');
  typeCmd('auth --verify-otp...');

  try {
    const res  = await fetch('/auth/verify-otp', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ otp }),
    });
    const data = await res.json();

    if (res.ok) {
      if (otpTimerInterval) clearInterval(otpTimerInterval);

      const flash = document.getElementById('otpFlash');
      flash.textContent = '✓ verified! redirecting...';
      flash.className   = 'flash success';
      flash.classList.remove('hidden');
      typeCmd('auth --verified');

      // Lock distro and redirect to the correct home — NOT just login tab
      const distro   = pendingDistro || getCurrentDistro();
      const redirect = DISTRO_REDIRECTS[distro] || '/home';
      localStorage.setItem('veyra-locked-distro', distro);

      setTimeout(() => {
        window.location.href = redirect;
      }, 1200);

    } else {
      errEl.textContent = data.error || 'incorrect code';
      document.getElementById('otpInput').value = '';
      typeCmd('auth --otp-error');
    }
  } catch {
    errEl.textContent = 'network error';
  } finally {
    document.getElementById('otpSubmitBtn').disabled = false;
    document.getElementById('otpLoader').classList.add('hidden');
  }
}

(function () {
  const btn = document.getElementById('avcVerifyBtn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    const note = document.getElementById('avcVerifyNote');
    if (note) { note.style.display = 'block'; setTimeout(() => note.style.display = 'none', 3000); }
  });
})();

