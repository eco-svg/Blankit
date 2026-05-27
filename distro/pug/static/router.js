(function () {
  // Each tab shows a group of sections (the original row pair)
  const ROUTES = {
    'notes':   ['sec-notes', 'sec-blinkbot'],
    'skills':  ['sec-skills', 'sec-achievements'],
    'social':  ['sec-social', 'sec-comms'],
    'habits':   ['sec-habits'],
    'buddybot': ['sec-buddybot'],
    'request':  ['sec-req-feature', 'sec-report'],
    'profile': ['sec-profile'],
  };

  const DEFAULT = 'notes';

  // All sections the router manages (dream-standalone is always visible)
  const ALL_SECTIONS = [...new Set(Object.values(ROUTES).flat())];

  function getRoute() {
    const hash = window.location.hash.replace('#', '').toLowerCase();
    return ROUTES[hash] !== undefined ? hash : DEFAULT;
  }

  function navigate(route, push) {
    const sections = ROUTES[route];
    if (sections === undefined) return;

    // Hide all managed sections
    ALL_SECTIONS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('page-hidden');
    });

    // Show this tab's sections
    sections.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('page-hidden');
    });

    // Scroll playground to top
    const pg = document.querySelector('.playground');
    if (pg) pg.scrollTop = 0;

    // Update nav active state
    document.querySelectorAll('.header-nav .nav-pill').forEach(a => {
      a.classList.toggle('nav-active', a.getAttribute('data-route') === route);
    });

    if (push) history.pushState({ route }, '', '#' + route);
  }

  // Expose navigate globally so other scripts can trigger tab switches
  window._veyraNavigate = navigate;

  document.addEventListener('DOMContentLoaded', function () {
    // Wire nav links
    document.querySelectorAll('.header-nav .nav-pill').forEach(a => {
      const href  = a.getAttribute('href') || '';
      // href is like #sec-notes or #sec-growth — extract the route key
      const secId  = href.replace('#sec-', '');
      const route  = Object.keys(ROUTES).find(k =>
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

    // Initial route
    navigate(getRoute(), false);
    if (!window.location.hash) history.replaceState({ route: DEFAULT }, '', '#' + DEFAULT);
  });

  window.addEventListener('popstate', function (e) {
    navigate(e.state?.route || getRoute(), false);
  });
})();
