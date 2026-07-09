/**
 * router.js — the client-side tab router. THE place to start reading the front-end.
 *
 * The whole pug app is ONE HTML page (home.html) that contains every feature's panel
 * ("section") at once. There is no server round-trip when you switch tabs — this file
 * just shows the sections for the active tab and hides all the others. The URL hash
 * (e.g. #habits) is the source of truth for "which tab", so Back/Forward and reloads work.
 *
 * Flow:  click a nav item / change the hash  →  navigate(route)  →  toggle .page-hidden
 *        on the right sections + light up the matching nav buttons + remember the choice.
 * Other scripts listen for the `veyra:navigate` event we fire so they can lazy-load a
 * tab's data the first time it's opened (see e.g. physique.js).
 */

(function () {
  // ROUTES: tab key  →  the DOM element id(s) that tab should reveal. Everything not
  // listed for the active tab gets hidden. A tab can show more than one section (e.g.
  // 'notes' shows both the notes column and the DMs column beside it).
  const ROUTES = {
    'notes':    ['sec-notes', 'sec-dms'],   // DMs fill the old Quick Ask column slot beside Notes
    'skills':   ['sec-skills-wrapper'],
    'physique': ['sec-physique-wrapper'],
    'social':   ['sec-comms'],
    'habits':   ['sec-habits', 'sec-habit-pulse'],
    'buddybot': ['sec-buddybot' /*, 'sec-ask' — Ask Anything card disabled */],
    'request':  ['sec-request'],
    'support':  ['sec-profile'],
    'profile':  ['sec-profile'],
    'stats':    ['sec-stats-wrapper'],
    'credits':  ['sec-credits'],
    'admin':    ['sec-admin', 'sec-admin-overview'],   // only present for admin accounts
  };

  // Tabs that also open the left sidebar ("lbar") — they have a secondary column of tools.
  const LBAR_ROUTES = new Set(['notes', 'habits', 'skills', 'physique']);
  // localStorage key remembering which tab is the user's chosen "home" (the default landing tab).
  const HOME_TAB_KEY = 'veyra_home_tab';
  // Flattened, de-duplicated list of every section id across all routes — so we can hide
  // them ALL in one sweep before revealing just the active tab's sections.
  const ALL_SECTIONS = [...new Set(Object.values(ROUTES).flat())];

  // The user's chosen home tab (falls back to 'habits' if unset or pointing at a dead route).
  function getHomeTab() {
    const stored = localStorage.getItem(HOME_TAB_KEY);
    return (stored && ROUTES[stored] !== undefined) ? stored : 'habits';
  }

  // The current tab, read from the URL hash; unknown/empty hash → the home tab.
  function getRoute() {
    const hash = window.location.hash.replace('#', '').toLowerCase();
    return ROUTES[hash] !== undefined ? hash : getHomeTab();
  }

  // Let other code (e.g. a "set as home" button) change which tab is the default landing tab.
  window._veyraSetHomeTab = function (route) {
    if (ROUTES[route] === undefined) return;
    localStorage.setItem(HOME_TAB_KEY, route);
    // Re-point every "home" nav button at the new home tab so it navigates there next time.
    document.querySelectorAll('[data-home="true"]').forEach(el => {
      el.setAttribute('data-route', route);
    });
  };

  // Small transient "<feature> — coming soon" popup, used for tabs that aren't open yet.
  function soonToast(name) {
    var t = document.createElement('div');
    t.className = 'veyra-soon-toast';
    t.textContent = (name || 'This') + ' — coming soon';
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });   // next frame → CSS fade-in
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 2400);
  }

  // The core: switch to `route`. `push` = also add a history entry (true for clicks, false
  // when we're just reacting to an existing hash on load / Back-Forward).
  function navigate(route, push) {
    // Physique is admin-only for now — bounce everyone else to home with a "soon" note.
    if (route === 'physique' && !window.VEYRA_IS_ADMIN) {
      soonToast('Physique');
      route = getHomeTab();
      push = true;
    }
    const sections = ROUTES[route];
    if (sections === undefined) return;   // unknown tab → do nothing

    // 1. Hide every section, then 2. reveal only the active tab's section(s).
    ALL_SECTIONS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('page-hidden');
    });
    sections.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('page-hidden');
    });

    // Reset scroll so each tab opens at the top, not wherever the last one was scrolled.
    const playground = document.querySelector('.playground');
    if (playground) playground.scrollTop = 0;

    // Highlight the active item in the top nav.
    document.querySelectorAll('.header-nav .nav-pill').forEach(a => {
      a.classList.toggle('nav-active', a.getAttribute('data-route') === route);
    });

    // Open/close the left sidebar and stamp the route on <body> (CSS keys off [data-route]).
    document.body.classList.toggle('lbar-open', LBAR_ROUTES.has(route));
    document.body.setAttribute('data-route', route);

    // Habits has a flip-card "pulse" widget that must re-measure once it's visible again.
    if (route === 'habits') {
      setTimeout(function() { window.dispatchEvent(new Event('habitPulseFlipped')); }, 60);
    }

    // Mirror the active state on the other two nav surfaces: left capsules + mobile bottom bar.
    document.querySelectorAll('.lbar-capsule').forEach(btn => {
      btn.classList.toggle('nav-active', btn.getAttribute('data-route') === route);
    });
    document.querySelectorAll('.mbb-tab').forEach(btn => {
      btn.classList.toggle('nav-active', btn.getAttribute('data-route') === route);
    });

    // Record in browser history (so Back works) and broadcast so feature scripts can
    // lazy-load this tab's data the first time it's shown.
    if (push) history.pushState({ route }, '', '#' + route);
    document.dispatchEvent(new CustomEvent('veyra:navigate', { detail: { route } }));
  }

  // Expose navigate() so other scripts can switch tabs programmatically.
  window._veyraNavigate = navigate;

  // On first load: turn the static nav links into router buttons and show the right tab.
  document.addEventListener('DOMContentLoaded', function () {
    // Top nav pills: figure out each link's route from its href (#sec-xxx), then hijack
    // the click so it routes in-page instead of jumping to an anchor.
    document.querySelectorAll('.header-nav .nav-pill').forEach(a => {
      const href  = a.getAttribute('href') || '';
      const secId = href.replace('#sec-', '').replace('#', '');
      // Match the href to a route key — either the key itself, or a route that lists this section.
      let route = Object.keys(ROUTES).find(k =>
        k === secId || (ROUTES[k] && ROUTES[k].includes('sec-' + secId))
      ) || secId;
      if (a.dataset.home === 'true') route = getHomeTab();   // the "home" pill follows the user's chosen home tab
      a.setAttribute('data-route', route);
      a.removeAttribute('href');           // drop the anchor so the URL doesn't hard-jump
      a.style.cursor = 'pointer';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        navigate(a.dataset.home === 'true' ? getHomeTab() : a.getAttribute('data-route'), true);
      });
    });

    // Left-sidebar capsule buttons → navigate to their data-route.
    document.querySelectorAll('.lbar-capsule').forEach(btn => {
      const route = btn.getAttribute('data-route');
      btn.addEventListener('click', function () {
        navigate(route, true);
      });
    });

    // Mobile bottom-bar tabs → navigate (the "home" tab follows the user's chosen home).
    document.querySelectorAll('.mbb-tab').forEach(btn => {
      btn.addEventListener('click', function () {
        const route = btn.dataset.home === 'true' ? getHomeTab() : btn.getAttribute('data-route');
        navigate(route, true);
      });
    });

    // Mobile "menu" button just opens the right-bar (rbar) toggle.
    const mbbMenu = document.getElementById('mbbMenuBtn');
    const rBarToggle = document.getElementById('rBarToggle');
    if (mbbMenu && rBarToggle) {
      mbbMenu.addEventListener('click', function () {
        rBarToggle.click();
      });
    }

    // Show whatever tab the URL/home says, without adding a history entry. Then, if there's
    // no hash yet, stamp the home tab into the URL so Back behaves from a known starting point.
    navigate(getRoute(), false);
    if (!window.location.hash) history.replaceState({ route: getHomeTab() }, '', '#' + getHomeTab());
  });

  // Browser Back/Forward: re-show the tab from the history entry (or current hash). No push.
  window.addEventListener('popstate', function (e) {
    navigate(e.state?.route || getRoute(), false);
  });
})();
