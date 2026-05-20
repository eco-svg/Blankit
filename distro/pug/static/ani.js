/* ============================================
   VEYRA — kscript.js (Cleaned)
   Auto-hide header · Active nav
   ============================================ */

// ── Auto-hide Header ──────────────────────────
(function () {
  const header = document.getElementById('mainHeader');
  let lastY = 0;
  let ticking = false;

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const y       = window.scrollY;
        const hiding  = y > lastY && y > 80;
        header.classList.toggle('hidden', hiding);
        document.body.classList.toggle('header-hidden', hiding);
        header.classList.toggle('scrolled', y > 10);
        lastY = y;
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
})();

// ── Floating Header Stars ─────────────────────
(function () {
  const container = document.getElementById('headerStars');
  if (!container) return;
  const COUNT = 28;
  for (let i = 0; i < COUNT; i++) {
    const s = document.createElement('span');
    s.className = 'header-star';
    const size = Math.random() * 2 + 1;       // 1–3 px
    const x    = Math.random() * 100;          // % across header
    const y    = Math.random() * 100;          // % down header
    const dur  = 4 + Math.random() * 8;        // 4–12 s
    const del  = Math.random() * dur;          // stagger
    s.style.cssText =
      `width:${size}px;height:${size}px;` +
      `left:${x}%;top:${y}%;` +
      `animation-duration:${dur}s;animation-delay:-${del}s;`;
    container.appendChild(s);
  }
})();

// ── Profile Popup Toggle ──────────────────────
(function () {
  const trigger = document.getElementById('profileTrigger');
  const popup   = document.getElementById('profilePopup');
  if (!trigger || !popup) return;

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    popup.classList.toggle('hidden');
  });

  document.addEventListener('click', e => {
    if (!popup.contains(e.target)) popup.classList.add('hidden');
  });
})();

// ── Active Nav Pill on Scroll ─────────────────
(function () {
  const pills = document.querySelectorAll('.nav-pill');
  const sections = Array.from(pills)
    .map(p => document.querySelector(p.getAttribute('href')))
    .filter(Boolean);

  if (!sections.length) return;

  const headerH = parseInt(getComputedStyle(document.documentElement)
    .getPropertyValue('--header-h')) || 62;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = '#' + entry.target.id;
          pills.forEach(p => p.classList.toggle('active', p.getAttribute('href') === id));
        }
      });
    },
    { rootMargin: `-${headerH + 10}px 0px -60% 0px`, threshold: 0 }
  );

  sections.forEach(s => observer.observe(s));
})();