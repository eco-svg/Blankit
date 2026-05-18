/* ═══════════════════════════════════════
   svg_animation.js — Blankit home
   ═══════════════════════════════════════ */

/* ══════════════════════════════
   THEME RESTORE
   ══════════════════════════════ */
const savedTheme = localStorage.getItem('ecosvg-theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

/* ══════════════════════════════
   DATE & GREETING
   ══════════════════════════════ */
function initGreeting() {
  const now  = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr  = now.toLocaleDateString('en-US', { weekday:'long', day:'numeric', month:'short', year:'numeric' })
                       .toUpperCase();

  const heroDate     = document.getElementById('heroDate');
  const heroGreeting = document.getElementById('heroGreeting');
  if (heroDate)     heroDate.textContent     = dateStr;
  if (heroGreeting) heroGreeting.textContent = greeting;
}

/* ══════════════════════════════
   RING PROGRESS
   ══════════════════════════════ */
function updateRing(pct) {
  const fill    = document.getElementById('ringFill');
  const pctText = document.getElementById('ringPct');
  const heroSub = document.getElementById('heroSub');
  if (!fill) return;

  const r           = 50;
  const circumference = 2 * Math.PI * r;
  const offset      = circumference - (pct / 100) * circumference;

  fill.style.strokeDasharray  = circumference;
  fill.style.strokeDashoffset = offset;
  if (pctText) pctText.textContent = pct + '%';
}

function updateHeroSub(done, total) {
  const sub = document.getElementById('heroSub');
  if (!sub) return;
  const left = total - done;
  if (total === 0)   sub.textContent = 'Add your first habit below ↓';
  else if (left === 0) sub.textContent = '🎉 All habits done for today!';
  else               sub.textContent = `You have ${left} habit${left !== 1 ? 's' : ''} left today`;
}

/* ══════════════════════════════
   HEATMAP
   ══════════════════════════════ */
function buildHeatmap(weekStats) {
  const el = document.getElementById('heatmap');
  if (!el) return;
  el.innerHTML = '';
  weekStats.forEach(day => {
    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';
    const pct = day.pct || 0;
    const level = pct === 0 ? 0 : pct < 34 ? 1 : pct < 67 ? 2 : pct < 100 ? 3 : 4;
    cell.setAttribute('data-level', level);
    cell.title = `${day.date}: ${pct}%`;
    el.appendChild(cell);
  });
}

/* ══════════════════════════════
   HABIT LIST — RENDER
   ══════════════════════════════ */
const TRACK_META = {
  manual: 'manual',
  gps:    '📍 GPS auto-tracked',
  camera: '📷 Camera AI',
  mic:    '🎙 Mic detected',
};

function renderHabits(habits) {
  const list = document.getElementById('habitList');
  if (!list) return;
  list.innerHTML = '';

  if (habits.length === 0) {
    list.innerHTML = `
      <li class="habit-item habit-empty" style="justify-content:center;padding:1.5rem 0">
        <span style="color:var(--clr-text-muted);font-size:0.8rem">
          No habits yet — hit + to add your first one
        </span>
      </li>`;
    return;
  }

  habits.forEach(h => {
    const li = document.createElement('li');
    li.className  = 'habit-item' + (h.done ? ' done' : '');
    li.dataset.id = h.id;

    const metaClass = (h.track_type !== 'manual') ? 'habit-meta auto-tracked' : 'habit-meta';
    const streakPct = Math.min((h.streak / 30) * 100, 100);

    li.innerHTML = `
      <button class="habit-check" aria-label="Toggle habit">
        <span class="check-inner">${h.done ? '✓' : ''}</span>
      </button>
      <div class="habit-info">
        <span class="habit-name">${escHtml(h.name)}</span>
        <span class="${metaClass}">${TRACK_META[h.track_type] || 'manual'}</span>
      </div>
      <div class="habit-right">
        <span class="habit-streak">${h.streak}d</span>
        <div class="habit-bar">
          <div class="habit-bar-fill" style="--pct:${streakPct}%"></div>
        </div>
      </div>`;

    li.querySelector('.habit-check').addEventListener('click', () => toggleHabit(h.id, li));
    list.appendChild(li);
  });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ══════════════════════════════
   TOGGLE HABIT
   ══════════════════════════════ */
async function toggleHabit(habitId, li) {
  try {
    const res  = await fetch(`/api/habits/${habitId}/toggle`, { method: 'POST' });
    const data = await res.json();

    const isDone    = data.done;
    const checkSpan = li.querySelector('.check-inner');

    li.classList.toggle('done', isDone);
    if (checkSpan) checkSpan.textContent = isDone ? '✓' : '';

    updateRing(data.completion_pct);

    // refresh sub text
    const allItems = document.querySelectorAll('#habitList .habit-item:not(.habit-empty)');
    const doneCount = document.querySelectorAll('#habitList .habit-item.done').length;
    updateHeroSub(doneCount, allItems.length);

    // badge toast
    if (data.new_badges && data.new_badges.length) {
      data.new_badges.forEach(b => showToast(`🏅 Badge unlocked: ${b.name}`));
    }
  } catch (e) {
    console.error('Toggle failed', e);
  }
}

/* ══════════════════════════════
   LOAD ALL DATA
   ══════════════════════════════ */
async function loadPage() {
  try {
    const [habitsRes, statsRes, weekRes] = await Promise.all([
      fetch('/api/habits'),
      fetch('/api/stats/today'),
      fetch('/api/stats/weekly'),
    ]);

    const habits    = await habitsRes.json();
    const stats     = await statsRes.json();
    const weekStats = await weekRes.json();

    renderHabits(habits);
    updateRing(stats.completion_pct || 0);
    updateHeroSub(stats.done || 0, stats.total || 0);
    buildHeatmap(weekStats);

    // streak display
    const maxStreak = habits.reduce((m, h) => Math.max(m, h.streak || 0), 0);
    const streakText = `🔥 ${maxStreak} day streak`;
    const gs = document.getElementById('globalStreak');
    const ss = document.getElementById('sidebarStreak');
    if (gs) gs.textContent = streakText;
    if (ss) ss.textContent = streakText;

  } catch (e) {
    console.error('Load failed', e);
  }
}

/* ══════════════════════════════
   ADD HABIT
   ══════════════════════════════ */
function initAddHabit() {
  const addBtn     = document.getElementById('addHabitBtn');
  const addModal   = document.getElementById('addModal');
  const addClose   = document.getElementById('addClose');
  const addConfirm = document.getElementById('addConfirm');
  const nameInput  = document.getElementById('newHabitName');
  const trackSel   = document.getElementById('newHabitTrack');

  if (!addBtn) return;

  addBtn.addEventListener('click', () => {
    addModal.classList.remove('hidden');
    nameInput.focus();
  });

  addClose.addEventListener('click', () => addModal.classList.add('hidden'));

  addModal.addEventListener('click', e => {
    if (e.target === addModal) addModal.classList.add('hidden');
  });

  addConfirm.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return;

    try {
      const res  = await fetch('/api/habits', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, track_type: trackSel.value }),
      });
      if (res.ok) {
        addModal.classList.add('hidden');
        nameInput.value = '';
        trackSel.value  = 'manual';
        await loadPage();
      }
    } catch (e) {
      console.error('Add habit failed', e);
    }
  });

  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addConfirm.click();
  });
}

/* ══════════════════════════════
   TOAST
   ══════════════════════════════ */
function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position:   'fixed',
    bottom:     '2rem',
    right:      '1.5rem',
    background: 'var(--clr-accent, #4a7c59)',
    color:      '#fff',
    padding:    '0.6rem 1.2rem',
    borderRadius: '8px',
    fontFamily: "'DM Mono',monospace",
    fontSize:   '0.78rem',
    zIndex:     '9999',
    boxShadow:  '0 4px 16px rgba(0,0,0,0.2)',
    opacity:    '0',
    transition: 'opacity 0.3s',
  });
  document.body.appendChild(t);
  requestAnimationFrame(() => t.style.opacity = '1');
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

/* ══════════════════════════════
   SIDEBAR
   ══════════════════════════════ */
function initSidebar() {
  const toggle   = document.getElementById('sidebarToggle');
  const sidebar  = document.getElementById('sidebar');
  const close    = document.getElementById('sidebarClose');
  const backdrop = document.getElementById('sidebarBackdrop');

  if (!toggle) return;

  function openSidebar()  { sidebar.classList.add('open');   backdrop.classList.remove('hidden'); }
  function closeSidebar() { sidebar.classList.remove('open'); backdrop.classList.add('hidden'); }

  toggle.addEventListener('click', openSidebar);
  close.addEventListener('click', closeSidebar);
  backdrop.addEventListener('click', closeSidebar);
}

/* ══════════════════════════════
   AI INSIGHT DISMISS
   ══════════════════════════════ */
function initAI() {
  const card    = document.querySelector('.ai-card');
  const dismiss = document.getElementById('aiDismiss');
  const accept  = document.getElementById('aiAccept');
  if (!dismiss || !card) return;

  const insights = [
    "You always skip reading on Wednesdays. Want to move it to Thursday morning?",
    "Your best habit streak is in the morning. Consider scheduling more habits before 9am.",
    "You've completed 80% of your habits this week — great consistency!",
    "You tend to skip habits on rainy days. Consider indoor alternatives.",
  ];

  document.getElementById('aiInsight').textContent =
    insights[Math.floor(Math.random() * insights.length)];

  dismiss.addEventListener('click', () => card.style.display = 'none');
  accept.addEventListener('click',  () => {
    showToast('✓ Suggestion applied');
    card.style.display = 'none';
  });
}

/* ══════════════════════════════
   ONE-TIME ONBOARDING TOUR
   ══════════════════════════════ */
const ONBOARDING_KEY = 'blankit-onboarded-' + (document.querySelector('meta[name="app-user"]')?.content || 'user');

const TOUR_STEPS = [
  { target: '#sidebarToggle', title: 'Navigation',     text: 'Open the sidebar to move between Home, History, Achievements and more.', pos: 'right' },
  { target: '#addHabitBtn',   title: 'Add a habit',    text: 'Tap + to create your first habit. Choose manual, GPS, Camera AI or Mic tracking.', pos: 'left' },
  { target: '.ring-wrap',     title: 'Daily progress', text: "This ring fills up as you complete habits. Aim for 100% every day!", pos: 'bottom' },
  { target: '.ai-card',       title: 'AI insights',    text: 'Blankit watches your patterns and suggests smart schedule tweaks.', pos: 'left' },
  { target: '#globalStreak',  title: 'Your streak',    text: "Complete all habits daily to grow your streak. Don't break the chain!", pos: 'bottom' },
];

let tourStep = 0;
let tourOverlay, tourSpotlight, tourTooltip;

function startTour() {
  if (localStorage.getItem(ONBOARDING_KEY)) return;
  buildTour();
  setTimeout(() => showTourStep(0), 900);
}

function buildTour() {
  tourOverlay = document.createElement('div');
  Object.assign(tourOverlay.style, { position:'fixed', inset:'0', zIndex:'9000', pointerEvents:'none' });

  tourSpotlight = document.createElement('div');
  Object.assign(tourSpotlight.style, {
    position:'fixed', borderRadius:'8px',
    boxShadow:'0 0 0 9999px rgba(0,0,0,0.7)',
    transition:'all 0.35s cubic-bezier(0.4,0,0.2,1)',
    zIndex:'9001', pointerEvents:'none',
  });

  tourTooltip = document.createElement('div');
  tourTooltip.innerHTML = `
    <div id="tb-label"></div>
    <h3 id="tb-title"></h3>
    <p id="tb-text"></p>
    <div id="tb-actions">
      <button id="tb-skip">Skip tour</button>
      <div id="tb-dots"></div>
      <button id="tb-next">Next →</button>
    </div>`;

  Object.assign(tourTooltip.style, {
    position:'fixed', zIndex:'9002',
    background:'rgba(10,10,12,0.94)',
    backdropFilter:'blur(16px)',
    border:'1px solid rgba(255,255,255,0.1)',
    borderRadius:'10px', padding:'1.2rem 1.4rem',
    width:'280px', fontFamily:"'DM Mono',monospace",
    color:'#e8e8e8', boxShadow:'0 8px 32px rgba(0,0,0,0.5)',
    transition:'top 0.3s ease, left 0.3s ease',
  });

  const style = document.createElement('style');
  style.textContent = `
    #tb-label{font-size:.55rem;color:rgba(255,255,255,.3);letter-spacing:.12em;margin-bottom:6px}
    #tb-title{font-size:.9rem;font-weight:700;color:var(--clr-accent,#4a7c59);margin-bottom:8px}
    #tb-text{font-size:.72rem;color:rgba(255,255,255,.6);line-height:1.6;margin-bottom:1rem}
    #tb-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}
    #tb-skip{font-family:inherit;font-size:.62rem;background:transparent;border:none;color:rgba(255,255,255,.28);cursor:pointer;padding:0}
    #tb-skip:hover{color:rgba(255,255,255,.5)}
    #tb-next{font-family:inherit;font-size:.68rem;background:transparent;border:1px solid var(--clr-accent,#4a7c59);color:var(--clr-accent,#4a7c59);border-radius:5px;padding:5px 14px;cursor:pointer;transition:background .15s,color .15s}
    #tb-next:hover{background:var(--clr-accent,#4a7c59);color:#fff}
    #tb-dots{display:flex;gap:5px}
    .tb-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.15);transition:background .2s}
    .tb-dot.active{background:var(--clr-accent,#4a7c59)}
    .tb-pulse{outline:2px solid var(--clr-accent,#4a7c59);outline-offset:3px;border-radius:6px}`;

  document.head.appendChild(style);
  document.body.appendChild(tourOverlay);
  document.body.appendChild(tourSpotlight);
  document.body.appendChild(tourTooltip);

  tourTooltip.querySelector('#tb-next').addEventListener('click', nextTourStep);
  tourTooltip.querySelector('#tb-skip').addEventListener('click', endTour);
}

function showTourStep(idx) {
  const step   = TOUR_STEPS[idx];
  const target = document.querySelector(step.target);
  if (!target) { nextTourStep(); return; }

  document.querySelectorAll('.tb-pulse').forEach(el => el.classList.remove('tb-pulse'));
  target.classList.add('tb-pulse');

  const r = target.getBoundingClientRect(), pad = 8;
  Object.assign(tourSpotlight.style, {
    top:    (r.top  - pad) + 'px',
    left:   (r.left - pad) + 'px',
    width:  (r.width  + pad * 2) + 'px',
    height: (r.height + pad * 2) + 'px',
  });

  tourTooltip.querySelector('#tb-label').textContent = `step ${idx + 1} of ${TOUR_STEPS.length}`;
  tourTooltip.querySelector('#tb-title').textContent = step.title;
  tourTooltip.querySelector('#tb-text').textContent  = step.text;
  tourTooltip.querySelector('#tb-next').textContent  = idx === TOUR_STEPS.length - 1 ? '✓ Done' : 'Next →';

  const dotsEl = tourTooltip.querySelector('#tb-dots');
  dotsEl.innerHTML = '';
  TOUR_STEPS.forEach((_, i) => {
    const d = document.createElement('span');
    d.className = 'tb-dot' + (i === idx ? ' active' : '');
    dotsEl.appendChild(d);
  });

  const tw = 280, th = 170;
  const vw = window.innerWidth, vh = window.innerHeight;
  let top, left;
  if      (step.pos === 'right')  { top = r.top + r.height/2 - th/2; left = r.right + 16; }
  else if (step.pos === 'left')   { top = r.top + r.height/2 - th/2; left = r.left - tw - 16; }
  else if (step.pos === 'bottom') { top = r.bottom + 16; left = r.left + r.width/2 - tw/2; }
  else                            { top = r.top - th - 16; left = r.left + r.width/2 - tw/2; }

  top  = Math.max(12, Math.min(top,  vh - th - 12));
  left = Math.max(12, Math.min(left, vw - tw - 12));
  Object.assign(tourTooltip.style, { top: top + 'px', left: left + 'px' });
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function nextTourStep() {
  tourStep++;
  if (tourStep >= TOUR_STEPS.length) endTour();
  else showTourStep(tourStep);
}

function endTour() {
  localStorage.setItem(ONBOARDING_KEY, '1');
  document.querySelectorAll('.tb-pulse').forEach(el => el.classList.remove('tb-pulse'));
  [tourOverlay, tourSpotlight, tourTooltip].forEach(el => {
    if (!el) return;
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 350);
  });
}

/* ══════════════════════════════
   INIT
   ══════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  initGreeting();
  initSidebar();
  initAddHabit();
  initAI();
  await loadPage();
  startTour();
});