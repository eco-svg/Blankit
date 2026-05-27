(function () {
  // Maps hash → section id. Growth → blinkbot until a dedicated section exists.
  const ROUTES = {
    'notes':        'sec-notes',
    'skills':       'sec-skills',
    'achievements': 'sec-achievements',
    'social':       'sec-social',
    'habits':       'sec-habits',
    'growth':       'sec-blinkbot',
    'comms':        'sec-comms',
  };

  const DEFAULT = 'notes';

  // Sections the router controls (dream is always visible, skip it)
  const ALL_SECTIONS = Object.values(ROUTES);

  function getRoute() {
    const hash = window.location.hash.replace('#', '').toLowerCase();
    return ROUTES[hash] ? hash : DEFAULT;
  }

  function navigate(route, push) {
    const targetId = ROUTES[route];
    if (!targetId) return;

    // Hide all managed sections
    ALL_SECTIONS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('page-hidden');
    });

    // Show target
    const target = document.getElementById(targetId);
    if (target) {
      target.classList.remove('page-hidden');
      // Scroll playground back to top on switch
      const pg = document.querySelector('.playground');
      if (pg) pg.scrollTop = 0;
    }

    // Update nav active state
    document.querySelectorAll('.header-nav .nav-pill').forEach(a => {
      const r = a.getAttribute('data-route');
      a.classList.toggle('nav-active', r === route);
    });

    if (push) history.pushState({ route }, '', '#' + route);
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Wire nav links
    document.querySelectorAll('.header-nav .nav-pill').forEach(a => {
      const href  = a.getAttribute('href') || '';
      const route = href.replace('#sec-', '').replace('#', '').toLowerCase();
      const mapped = Object.keys(ROUTES).find(k => ROUTES[k] === 'sec-' + route) || route;
      a.setAttribute('data-route', mapped);
      a.removeAttribute('href');
      a.style.cursor = 'pointer';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        navigate(mapped, true);
      });
    });

    // Initial route
    navigate(getRoute(), false);
    if (!window.location.hash) history.replaceState({ route: DEFAULT }, '', '#' + DEFAULT);
  });

  // Browser back/forward
  window.addEventListener('popstate', function (e) {
    navigate(e.state?.route || getRoute(), false);
  });
})();
