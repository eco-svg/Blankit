/* ═══════════════════════════════════════════
   svg_animation.js — ecosvg habit tracker
   All interactivity: theme, habits, ring, heatmap, modals, sidebar
   ═══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ══════════════════════════════
   RESTORE ANIMATION PREFERENCE
   ══════════════════════════════ */
if (localStorage.getItem('ecosvg-no-anim') === 'true') {
  document.body.classList.add('no-anim');
}

  /* ══════════════════════════════
     THEME SWITCHER
     ══════════════════════════════ */
  const themeSwitcher = document.getElementById('themeSwitcher');
  if (themeSwitcher) {
    themeSwitcher.addEventListener('click', e => {
      const btn = e.target.closest('.theme-btn');
      if (!btn) return;
      const theme = btn.dataset.theme;
      document.documentElement.setAttribute('data-theme', theme);
      document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      localStorage.setItem('ecosvg-theme', theme);
      if (localStorage.getItem('ecosvg-no-anim') === 'true') {
        document.body.classList.add('no-anim');
      }
    });
  }

  /* restore saved theme */
  const savedTheme = localStorage.getItem('ecosvg-theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.querySelectorAll('.theme-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === savedTheme);
    });
  }

  /* ══════════════════════════════
     GREETING + DATE
     ══════════════════════════════ */
  function updateGreeting() {
    const now = new Date();
    const hour = now.getHours();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    let greeting = 'Good morning';
    if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
    else if (hour >= 17) greeting = 'Good evening';

    const heroDate = document.getElementById('heroDate');
    const heroGreeting = document.getElementById('heroGreeting');
    if (heroDate) heroDate.textContent =
      `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
    if (heroGreeting) heroGreeting.textContent = greeting;
  }
  updateGreeting();

  /* ══════════════════════════════
     HABIT TOGGLE + PROGRESS RING
     ══════════════════════════════ */
  function updateRing() {
    const items = document.querySelectorAll('.habit-item');
    const done = document.querySelectorAll('.habit-item.done').length;
    const total = items.length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    const circum = 314;
    const offset = circum - (circum * pct / 100);

    const ringFill = document.getElementById('ringFill');
    const ringPct = document.getElementById('ringPct');
    const heroSub = document.getElementById('heroSub');

    if (ringFill) ringFill.style.strokeDashoffset = offset;
    if (ringPct) ringPct.textContent = pct + '%';

    const remaining = total - done;
    if (heroSub) heroSub.textContent =
      remaining === 0
        ? 'All habits done today! 🎉'
        : `You have ${remaining} habit${remaining > 1 ? 's' : ''} left today`;
  }

  const habitList = document.getElementById('habitList');
  if (habitList) {
    habitList.addEventListener('click', e => {
      const item = e.target.closest('.habit-item');
      if (!item) return;
      const meta = item.querySelector('.habit-meta');
      if (meta && meta.classList.contains('auto-tracked') && meta.textContent.includes('Camera')) {
        if (!item.classList.contains('done')) {
          openCamOverlay();
          return;
        }
      }
      item.classList.toggle('done');
      updateRing();
    });
    updateRing();
  }

  /* ══════════════════════════════
     HEATMAP GENERATION
     ══════════════════════════════ */
  function buildHeatmap() {
    const heatmap = document.getElementById('heatmap');
    if (!heatmap) return;
    heatmap.innerHTML = '';
    const mockData = [
      [4, 3, 2, 4, 1, 3, 4],
      [3, 4, 1, 2, 4, 3, 2],
      [2, 1, 4, 3, 2, 4, 1],
      [4, 2, 3, 4, 3, 1, 3],
    ];
    mockData.forEach(row => {
      row.forEach(level => {
        const cell = document.createElement('div');
        cell.className = 'heat-cell';
        cell.dataset.level = level;
        heatmap.appendChild(cell);
      });
    });
  }
  buildHeatmap();

  /* ══════════════════════════════
     CAMERA AI MODAL
     ══════════════════════════════ */
  const camOverlay = document.getElementById('camOverlay');
  const camClose = document.getElementById('camClose');
  const camStartBtn = document.getElementById('camStartBtn');
  const camCounter = document.getElementById('camCounter');

  let counting = false;
  let countValue = 0;
  let countTimer = null;

  function openCamOverlay() {
    if (!camOverlay) return;
    camOverlay.classList.remove('hidden');
    countValue = 0;
    if (camCounter) camCounter.textContent = '0';
    if (camStartBtn) camStartBtn.textContent = 'Start counting';
    counting = false;
  }

  if (camClose) {
    camClose.addEventListener('click', () => {
      camOverlay.classList.add('hidden');
      clearInterval(countTimer);
      counting = false;
    });
  }

  if (camStartBtn) {
    camStartBtn.addEventListener('click', () => {
      if (counting) return;
      counting = true;
      camStartBtn.textContent = 'Counting…';
      countTimer = setInterval(() => {
        countValue++;
        camCounter.textContent = countValue;
        if (countValue >= 10) {
          clearInterval(countTimer);
          counting = false;
          camStartBtn.textContent = '✓ 10 reps done!';
          setTimeout(() => {
            camOverlay.classList.add('hidden');
            document.querySelectorAll('.habit-item').forEach(item => {
              const meta = item.querySelector('.habit-meta');
              if (meta && meta.textContent.includes('Camera')) {
                item.classList.add('done');
              }
            });
            updateRing();
          }, 800);
        }
      }, 600);
    });
  }

  /* ══════════════════════════════
     ADD HABIT MODAL
     ══════════════════════════════ */
  const addModal = document.getElementById('addModal');
  const addClose = document.getElementById('addClose');
  const addHabitBtn = document.getElementById('addHabitBtn');
  const addConfirm = document.getElementById('addConfirm');
  const newHabitName = document.getElementById('newHabitName');
  const newHabitTrack = document.getElementById('newHabitTrack');

  if (addHabitBtn) {
    addHabitBtn.addEventListener('click', () => {
      addModal.classList.remove('hidden');
      newHabitName.focus();
    });
  }
  if (addClose) {
    addClose.addEventListener('click', () => addModal.classList.add('hidden'));
  }
  if (addConfirm) {
    addConfirm.addEventListener('click', () => {
      const name = newHabitName.value.trim();
      const track = newHabitTrack.value;
      if (!name) return;
      const trackLabels = {
        manual: 'manual',
        gps: '📍 GPS auto-tracked',
        camera: '📷 Camera AI',
        mic: '🎙 Mic detected',
      };
      const li = document.createElement('li');
      li.className = 'habit-item';
      li.dataset.id = Date.now();
      li.innerHTML = `
        <button class="habit-check" aria-label="Toggle habit">
          <span class="check-inner"></span>
        </button>
        <div class="habit-info">
          <span class="habit-name">${name}</span>
          <span class="habit-meta ${track !== 'manual' ? 'auto-tracked' : ''}">${trackLabels[track]}</span>
        </div>
        <div class="habit-right">
          <span class="habit-streak">0d</span>
          <div class="habit-bar"><div class="habit-bar-fill" style="--pct:0%"></div></div>
        </div>
      `;
      document.getElementById('habitList').appendChild(li);
      updateRing();
      newHabitName.value = '';
      newHabitTrack.value = 'manual';
      addModal.classList.add('hidden');
    });
  }

  /* close modals on backdrop click */
  [camOverlay, addModal].forEach(overlay => {
    if (overlay) {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.add('hidden');
      });
    }
  });

  /* ══════════════════════════════
     AI INSIGHT
     ══════════════════════════════ */
  const insights = [
    "You always skip reading on Wednesdays. Want to move it to Thursday morning?",
    "Your step count drops on rainy days. Try an indoor walk habit as backup?",
    "You've completed your morning habits 100% this week. Keep the streak alive!",
    "Meditation is your weakest streak (2d). Try pairing it right after your walk.",
  ];
  let insightIdx = 0;

  const acceptBtn = document.querySelector('.ai-btn.accept');
  const dismissBtn = document.querySelector('.ai-btn.dismiss');
  if (acceptBtn) {
    acceptBtn.addEventListener('click', () => {
      insightIdx = (insightIdx + 1) % insights.length;
      document.getElementById('aiInsight').textContent = insights[insightIdx];
    });
  }
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      insightIdx = (insightIdx + 1) % insights.length;
      document.getElementById('aiInsight').textContent = insights[insightIdx];
    });
  }

  /* ══════════════════════════════
     SIDEBAR
     ══════════════════════════════ */
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebarClose = document.getElementById('sidebarClose');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.add('open');
      sidebarBackdrop.classList.remove('hidden');
    });
  }
  if (sidebarClose) {
    sidebarClose.addEventListener('click', () => {
      sidebar.classList.remove('open');
      sidebarBackdrop.classList.add('hidden');
    });
  }
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => {
      sidebar.classList.remove('open');
      sidebarBackdrop.classList.add('hidden');
    });
  }

}); 

/* ══════════════════════════════
   ANIMATION TOGGLE (settings page)
   ══════════════════════════════ */
const animToggle = document.getElementById('animToggle');
if (animToggle) {
  const noAnim = localStorage.getItem('ecosvg-no-anim') === 'true';
  animToggle.setAttribute('aria-pressed', noAnim ? 'false' : 'true');

  animToggle.addEventListener('click', () => {
    const isOn = animToggle.getAttribute('aria-pressed') === 'true';
    animToggle.setAttribute('aria-pressed', isOn ? 'false' : 'true');
    document.body.classList.toggle('no-anim', isOn);
    localStorage.setItem('ecosvg-no-anim', isOn ? 'true' : 'false');
  });
}