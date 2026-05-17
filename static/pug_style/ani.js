/* ============================================
   BLANKIT — kscript.js (Cleaned)
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