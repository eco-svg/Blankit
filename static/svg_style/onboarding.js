/* ═══════════════════════════════════════
   onboarding.js — Blankit first-time guide
   Shows once per user, stored in localStorage
   ═══════════════════════════════════════ */

const ONBOARDING_KEY = 'blankit-onboarded-' + (window.__blankit_user || 'user');

const STEPS = [
  {
    target:  '#sidebarToggle',
    title:   'Navigation',
    text:    'Open the sidebar here to move between Home, History, Achievements and more.',
    pos:     'right',
  },
  {
    target:  '#addHabitBtn',
    title:   'Add a habit',
    text:    'Tap + to create your first habit. Choose manual check-in, GPS, Camera AI or Mic tracking.',
    pos:     'left',
  },
  {
    target:  '.ring-wrap',
    title:   'Daily progress',
    text:    'This ring shows how many of today\'s habits you\'ve completed. Aim for 100%!',
    pos:     'bottom',
  },
  {
    target:  '.ai-card',
    title:   'AI insights',
    text:    'Blankit watches your patterns and suggests smart tweaks — like rescheduling habits you often skip.',
    pos:     'left',
  },
  {
    target:  '#globalStreak',
    title:   'Your streak',
    text:    'Keep completing all habits daily to grow your streak. Don\'t break the chain!',
    pos:     'bottom',
  },
];

let currentStep = 0;
let overlay, spotlight, tooltip;

function createGuide() {
  // Dark overlay
  overlay = document.createElement('div');
  overlay.id = 'ob-overlay';
  Object.assign(overlay.style, {
    position:   'fixed',
    inset:      '0',
    zIndex:     '9000',
    pointerEvents: 'none',
  });

  // Spotlight cutout via box-shadow
  spotlight = document.createElement('div');
  spotlight.id = 'ob-spotlight';
  Object.assign(spotlight.style, {
    position:      'fixed',
    borderRadius:  '8px',
    boxShadow:     '0 0 0 9999px rgba(0,0,0,0.72)',
    transition:    'all 0.35s cubic-bezier(0.4,0,0.2,1)',
    zIndex:        '9001',
    pointerEvents: 'none',
  });

  // Tooltip card
  tooltip = document.createElement('div');
  tooltip.id = 'ob-tooltip';
  tooltip.innerHTML = `
    <div id="ob-step-label"></div>
    <h3 id="ob-title"></h3>
    <p id="ob-text"></p>
    <div id="ob-actions">
      <button id="ob-skip">Skip tour</button>
      <div id="ob-dots"></div>
      <button id="ob-next">Next →</button>
    </div>
  `;
  Object.assign(tooltip.style, {
    position:     'fixed',
    zIndex:       '9002',
    background:   'rgba(10,10,12,0.92)',
    backdropFilter: 'blur(16px)',
    border:       '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    padding:      '1.2rem 1.4rem',
    width:        '280px',
    fontFamily:   "'JetBrains Mono', monospace",
    color:        '#e8e8e8',
    boxShadow:    '0 8px 32px rgba(0,0,0,0.5)',
    transition:   'all 0.3s ease',
  });

  // Tooltip inner styles via stylesheet
  const style = document.createElement('style');
  style.textContent = `
    #ob-step-label {
      font-size: 0.55rem;
      color: rgba(255,255,255,0.3);
      letter-spacing: 0.12em;
      margin-bottom: 6px;
    }
    #ob-title {
      font-size: 0.9rem;
      font-weight: 700;
      color: var(--accent, #e8b84b);
      margin-bottom: 8px;
      letter-spacing: 0.03em;
    }
    #ob-text {
      font-size: 0.72rem;
      color: rgba(255,255,255,0.6);
      line-height: 1.6;
      margin-bottom: 1rem;
    }
    #ob-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    #ob-skip {
      font-family: inherit;
      font-size: 0.62rem;
      background: transparent;
      border: none;
      color: rgba(255,255,255,0.28);
      cursor: pointer;
      padding: 0;
      letter-spacing: 0.04em;
    }
    #ob-skip:hover { color: rgba(255,255,255,0.5); }
    #ob-next {
      font-family: inherit;
      font-size: 0.68rem;
      background: transparent;
      border: 1px solid var(--accent, #e8b84b);
      color: var(--accent, #e8b84b);
      border-radius: 5px;
      padding: 5px 14px;
      cursor: pointer;
      letter-spacing: 0.04em;
      transition: background 0.15s, color 0.15s;
    }
    #ob-next:hover {
      background: var(--accent, #e8b84b);
      color: rgba(0,0,0,0.85);
    }
    #ob-dots {
      display: flex;
      gap: 5px;
    }
    .ob-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: rgba(255,255,255,0.15);
      transition: background 0.2s;
    }
    .ob-dot.active {
      background: var(--accent, #e8b84b);
    }
    /* pulse ring on spotlight target */
    .ob-pulse {
      outline: 2px solid var(--accent, #e8b84b);
      outline-offset: 3px;
      border-radius: 6px;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(overlay);
  document.body.appendChild(spotlight);
  document.body.appendChild(tooltip);

  tooltip.querySelector('#ob-next').addEventListener('click', nextStep);
  tooltip.querySelector('#ob-skip').addEventListener('click', finishGuide);
}

function showStep(index) {
  const step   = STEPS[index];
  const target = document.querySelector(step.target);
  if (!target) { nextStep(); return; }

  // Remove previous pulse
  document.querySelectorAll('.ob-pulse').forEach(el => el.classList.remove('ob-pulse'));
  target.classList.add('ob-pulse');

  // Spotlight position
  const r   = target.getBoundingClientRect();
  const pad = 8;
  Object.assign(spotlight.style, {
    top:    (r.top  - pad) + 'px',
    left:   (r.left - pad) + 'px',
    width:  (r.width  + pad * 2) + 'px',
    height: (r.height + pad * 2) + 'px',
  });

  // Tooltip content
  tooltip.querySelector('#ob-step-label').textContent = `step ${index + 1} of ${STEPS.length}`;
  tooltip.querySelector('#ob-title').textContent      = step.title;
  tooltip.querySelector('#ob-text').textContent       = step.text;
  tooltip.querySelector('#ob-next').textContent       = index === STEPS.length - 1 ? '✓ Done' : 'Next →';

  // Dots
  const dotsEl = tooltip.querySelector('#ob-dots');
  dotsEl.innerHTML = '';
  STEPS.forEach((_, i) => {
    const d = document.createElement('span');
    d.className = 'ob-dot' + (i === index ? ' active' : '');
    dotsEl.appendChild(d);
  });

  // Position tooltip relative to target
  const tw = 280, th = 160;
  const vw = window.innerWidth, vh = window.innerHeight;
  let top, left;

  if (step.pos === 'right') {
    top  = r.top + r.height / 2 - th / 2;
    left = r.right + 16;
  } else if (step.pos === 'left') {
    top  = r.top + r.height / 2 - th / 2;
    left = r.left - tw - 16;
  } else if (step.pos === 'bottom') {
    top  = r.bottom + 16;
    left = r.left + r.width / 2 - tw / 2;
  } else {
    top  = r.top - th - 16;
    left = r.left + r.width / 2 - tw / 2;
  }

  // Clamp within viewport
  top  = Math.max(12, Math.min(top,  vh - th - 12));
  left = Math.max(12, Math.min(left, vw - tw - 12));

  Object.assign(tooltip.style, { top: top + 'px', left: left + 'px' });

  // Scroll target into view
  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
}

function nextStep() {
  currentStep++;
  if (currentStep >= STEPS.length) {
    finishGuide();
  } else {
    showStep(currentStep);
  }
}

function finishGuide() {
  localStorage.setItem(ONBOARDING_KEY, '1');
  document.querySelectorAll('.ob-pulse').forEach(el => el.classList.remove('ob-pulse'));
  [overlay, spotlight, tooltip].forEach(el => {
    if (el) el.style.opacity = '0';
    setTimeout(() => el && el.remove(), 350);
  });
}

function startGuide() {
  if (localStorage.getItem(ONBOARDING_KEY)) return; // already seen
  createGuide();
  // Small delay so page fully renders
  setTimeout(() => showStep(0), 800);
}

// Auto-start on load
document.addEventListener('DOMContentLoaded', startGuide);