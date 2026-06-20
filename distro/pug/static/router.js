/**
 * router.js — Client-side tab router — maps each tab to the page sections it shows/hides, and updates nav state.
 */

(function () {
  const ROUTES = {
    'notes':    ['sec-notes', 'sec-dms'],   // DMs fill the old Quick Ask column slot beside Notes
    'skills':   ['sec-skills-wrapper'],
    'social':   ['sec-comms'],
    'habits':   ['sec-habits', 'sec-habit-pulse'],
    'buddybot': ['sec-buddybot' /*, 'sec-ask' — Ask Anything card disabled */],
    'request':  ['sec-request'],
    'support':  ['sec-profile'],
    'profile':  ['sec-profile'],
    'stats':    ['sec-stats-wrapper'],
    'credits':  ['sec-credits'],
    'admin':    ['sec-admin'],   // only present for admin accounts
  };

  const LBAR_ROUTES = new Set(['notes', 'habits', 'skills']);
  const HOME_TAB_KEY = 'veyra_home_tab';
  const ALL_SECTIONS = [...new Set(Object.values(ROUTES).flat())];

  function getHomeTab() {
    // Guests land on the community feed (the only thing they can browse); habits and
    // the other tabs are personal/account-gated.
    if (window.VEYRA_GUEST) return 'social';
    const stored = localStorage.getItem(HOME_TAB_KEY);
    return (stored && ROUTES[stored] !== undefined) ? stored : 'habits';
  }

  function getRoute() {
    const hash = window.location.hash.replace('#', '').toLowerCase();
    return ROUTES[hash] !== undefined ? hash : getHomeTab();
  }

  window._veyraSetHomeTab = function (route) {
    if (ROUTES[route] === undefined) return;
    localStorage.setItem(HOME_TAB_KEY, route);
    document.querySelectorAll('[data-home="true"]').forEach(el => {
      el.setAttribute('data-route', route);
    });
  };

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
    document.body.setAttribute('data-route', route);

    if (route === 'habits') {
      setTimeout(function() { window.dispatchEvent(new Event('habitPulseFlipped')); }, 60);
    }

    document.querySelectorAll('.lbar-capsule').forEach(btn => {
      btn.classList.toggle('nav-active', btn.getAttribute('data-route') === route);
    });

    document.querySelectorAll('.mbb-tab').forEach(btn => {
      btn.classList.toggle('nav-active', btn.getAttribute('data-route') === route);
    });

    if (push) history.pushState({ route }, '', '#' + route);
    document.dispatchEvent(new CustomEvent('veyra:navigate', { detail: { route } }));
  }

  window._veyraNavigate = navigate;

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.header-nav .nav-pill').forEach(a => {
      const href  = a.getAttribute('href') || '';
      const secId = href.replace('#sec-', '').replace('#', '');
      let route = Object.keys(ROUTES).find(k =>
        k === secId || (ROUTES[k] && ROUTES[k].includes('sec-' + secId))
      ) || secId;
      if (a.dataset.home === 'true') route = getHomeTab();
      a.setAttribute('data-route', route);
      a.removeAttribute('href');
      a.style.cursor = 'pointer';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        navigate(a.dataset.home === 'true' ? getHomeTab() : a.getAttribute('data-route'), true);
      });
    });

    document.querySelectorAll('.lbar-capsule').forEach(btn => {
      const route = btn.getAttribute('data-route');
      btn.addEventListener('click', function () {
        navigate(route, true);
      });
    });

    document.querySelectorAll('.mbb-tab').forEach(btn => {
      btn.addEventListener('click', function () {
        const route = btn.dataset.home === 'true' ? getHomeTab() : btn.getAttribute('data-route');
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
    if (!window.location.hash) history.replaceState({ route: getHomeTab() }, '', '#' + getHomeTab());
  });

  window.addEventListener('popstate', function (e) {
    navigate(e.state?.route || getRoute(), false);
  });
})();
