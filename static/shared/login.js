/* ═══════════════════════════════════════
   login.js — Blankit auth
   ═══════════════════════════════════════ */

/* ══════════════════════════════
   DISTRO DATA
   ══════════════════════════════ */
const DISTROS = {
  ecosvg:   { maintainer: 'eco-svg',  focus: 'habit tracking + AI insights', status: '● active', about: '— to be filled —' },
  divyanhu: { maintainer: 'divyanhu', focus: '— to be filled —',             status: '● active', about: '— to be filled —' },
  thepug:   { maintainer: 'thepug',   focus: '— to be filled —',             status: '● active', about: '— to be filled —' },
};

const DISTRO_KEYS = ['ecosvg', 'divyanhu', 'thepug'];
const BG_IDS      = { ecosvg: 'bg-ecosvg', divyanhu: 'bg-divyanhu', thepug: 'bg-thepug' };

/* ══════════════════════════════
   STATE
   ══════════════════════════════ */
let currentIndex = 0;
let isLocked     = false;
let lockedDistro = null;

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

swiper.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
}, { passive: true });

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

const savedLocked = localStorage.getItem('blankit-locked-distro');
if (savedLocked && DISTRO_KEYS.includes(savedLocked)) {
  const idx = DISTRO_KEYS.indexOf(savedLocked);
  showCard(idx, 1);
  lockDistro(savedLocked);
}

/* ══════════════════════════════
   TAB SWITCHER
   ══════════════════════════════ */
const tabs      = document.querySelectorAll('.tab');
const tabLine   = document.getElementById('tabLine');
const authLabel = document.getElementById('authLabel');

function switchTab(name) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${name}`).classList.add('active');
  positionTabLine(name);
  clearAllErrors();
  const labels = { login: 'auth.login', register: 'auth.register', forgot: 'auth.forgot_password' };
  authLabel.textContent = labels[name] || name;
  typeCmd(`auth --mode=${name}`);
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
      localStorage.setItem('blankit-locked-distro', getCurrentDistro());
      lockDistro(getCurrentDistro());
      showFlash('loginFlash', '✓ authenticated. redirecting...', 'success');
      typeCmd(`auth --success redirect=${data.redirect}`);
      setTimeout(() => window.location.href = data.redirect, 900);
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
  let ok = true;

  if (!username || username.length < 3)      { setErr('regUsernameErr', 'min 3 chars'); ok = false; }
  else if (!/^[a-zA-Z0-9_]+$/.test(username)) { setErr('regUsernameErr', 'a-z 0-9 _ only'); ok = false; }
  if (!validEmail(email))                    { setErr('regEmailErr', 'invalid email'); ok = false; }
  if (!password || password.length < 8)      { setErr('regPasswordErr', 'min 8 chars'); ok = false; }
  if (password !== confirm)                  { setErr('regConfirmErr', 'passwords do not match'); ok = false; }
  if (!ok) return;

  setLoading('registerBtn', 'registerLoader', true);
  typeCmd('auth --register --processing...');

  try {
    const res  = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, distro: getCurrentDistro() }),
    });

    const data = await res.json();

    if (res.ok) {
      localStorage.setItem('blankit-locked-distro', getCurrentDistro());
      lockDistro(getCurrentDistro());
      showFlash('registerFlash', '✓ account created. please sign in.', 'success');
      typeCmd('auth --register --success');
      setTimeout(() => switchTab('login'), 1500);
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
  const map = { 'panel-login': 'loginBtn', 'panel-register': 'registerBtn', 'panel-forgot': 'forgotBtn' };
  const btn = map[active.id];
  if (btn) document.getElementById(btn).click();
});