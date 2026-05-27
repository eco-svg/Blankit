(function () {
  const ROUTES = {
    'notes':    ['sec-notes', 'sec-blinkbot'],
    'skills':   ['sec-skills', 'sec-achievements'],
    'social':   ['sec-social', 'sec-comms'],
    'habits':   ['sec-habits'],
    'buddybot': ['sec-buddybot'],
    'request':  ['sec-profile'],
    'support':  ['sec-profile'],
    'profile':  ['sec-profile'],
    'stats':    ['sec-stats'],
  };

  const LBAR_ROUTES = new Set(['notes', 'habits', 'skills']);
  const DEFAULT = 'notes';
  const ALL_SECTIONS = [...new Set(Object.values(ROUTES).flat())];

  function getRoute() {
    const hash = window.location.hash.replace('#', '').toLowerCase();
    return ROUTES[hash] !== undefined ? hash : DEFAULT;
  }

  function navigate(route, push) {
    const sections = ROUTES[route];
    if (sections === undefined) return;

    ALL_SECTIONS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('page-hidden');
    });

    sections.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('page-hidden');
    });

    const pg = document.querySelector('.playground');
    if (pg) pg.scrollTop = 0;

    document.querySelectorAll('.header-nav .nav-pill').forEach(a => {
      a.classList.toggle('nav-active', a.getAttribute('data-route') === route);
    });

    document.body.classList.toggle('lbar-open', LBAR_ROUTES.has(route));

    document.querySelectorAll('.lbar-capsule').forEach(btn => {
      btn.classList.toggle('nav-active', btn.getAttribute('data-route') === route);
    });

    document.querySelectorAll('.mbb-tab').forEach(btn => {
      btn.classList.toggle('nav-active', btn.getAttribute('data-route') === route);
    });

    if (push) history.pushState({ route }, '', '#' + route);
  }

  window._veyraNavigate = navigate;

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.header-nav .nav-pill').forEach(a => {
      const href  = a.getAttribute('href') || '';
      const secId = href.replace('#sec-', '').replace('#', '');
      const route = Object.keys(ROUTES).find(k =>
        k === secId || (ROUTES[k] && ROUTES[k].includes('sec-' + secId))
      ) || secId;
      a.setAttribute('data-route', route);
      a.removeAttribute('href');
      a.style.cursor = 'pointer';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        navigate(route, true);
      });
    });

    document.querySelectorAll('.lbar-capsule').forEach(btn => {
      const route = btn.getAttribute('data-route');
      btn.addEventListener('click', function () {
        navigate(route, true);
      });
    });

    document.querySelectorAll('.mbb-tab').forEach(btn => {
      const route = btn.getAttribute('data-route');
      btn.addEventListener('click', function () {
        navigate(route, true);
      });
    });

    const mbbMenu = document.getElementById('mbbMenuBtn');
    const rBarToggle = document.getElementById('rBarToggle');
    if (mbbMenu && rBarToggle) {
      mbbMenu.addEventListener('click', function () {
        rBarToggle.click();
      });
    }

    navigate(getRoute(), false);
    if (!window.location.hash) history.replaceState({ route: DEFAULT }, '', '#' + DEFAULT);
  });

  window.addEventListener('popstate', function (e) {
    navigate(e.state?.route || getRoute(), false);
  });
})();
