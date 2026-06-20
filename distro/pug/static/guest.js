/**
 * guest.js — read-only guest mode. Active only when window.VEYRA_GUEST is true.
 *
 * Guests can BROWSE the community (read posts, view counts, read comments, copy a
 * share link) but every WRITE or CONTACT action is intercepted and replaced with a
 * "sign up" prompt. A persistent bottom banner nudges them to register.
 *
 * Reads we deliberately DON'T gate: expanding the comments preview, the share/
 * copy-link button, and plain navigation within the community feed.
 */
(function () {
  if (!window.VEYRA_GUEST) return;

  // Controls that perform a write or contact action (NOT reads).
  var GATED_SELECTOR = [
    '#commComposeBtn',                 // new post
    '[data-action="like"]',            // react (up)
    '[data-action="dislike"]',         // react (down)
    '.comm-action-btn',                // Buy / Collab / Learn / Hire — opens a DM
    '.pub-action-btn',                 // Hire / Collab / +Friend on the profile modal
    '.comm-comment-send',              // post a comment
    '.comm-comment-input',             // (focus) post a comment
    '#blinkCardInput', '#blinkCardSend', '#blinkCardMic', '#blinkCardBtn'  // BlinkBot (guest-try is a later step)
    // NOTE: Notes / Habits / To-do are NOT gated — they work locally via guest-store.js.
  ].join(',');

  function verbFor(t) {
    if (t.matches('#commComposeBtn')) return 'post';
    if (t.matches('.comm-action-btn,.pub-action-btn')) return 'contact this person';
    if (t.matches('[data-action="like"],[data-action="dislike"]')) return 'react to posts';
    if (t.matches('.comm-comment-send,.comm-comment-input')) return 'comment';
    if (t.matches('#blinkCardInput,#blinkCardSend,#blinkCardMic,#blinkCardBtn')) return 'use BlinkBot';
    return 'do this';
  }

  function showPrompt(action) {
    if (document.getElementById('guestPromptOverlay')) return;
    var ov = document.createElement('div');
    ov.id = 'guestPromptOverlay';
    ov.className = 'guest-prompt-overlay';
    ov.innerHTML =
      '<div class="guest-prompt">' +
        '<div class="guest-prompt-title">Sign up to ' + action + '</div>' +
        '<div class="guest-prompt-sub">You’re browsing Veyra as a guest. Create a free account to post, message, and track your own progress.</div>' +
        '<div class="guest-prompt-actions">' +
          '<button class="guest-prompt-cancel" type="button">Keep looking</button>' +
          '<a class="guest-prompt-cta" href="/">Sign up — it’s free</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    var close = function () { ov.remove(); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.guest-prompt-cancel').addEventListener('click', close);
  }
  window._veyraGuestPrompt = showPrompt;

  // Capture-phase interceptor — fires BEFORE each feature's own handler, so the
  // write never happens. Covers dynamically-rendered feed controls too.
  ['click', 'focusin'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      var t = e.target.closest && e.target.closest(GATED_SELECTOR);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (t.tagName === 'INPUT') { try { t.blur(); } catch (_) {} }
      showPrompt(verbFor(t));
    }, true);
  });

  // Persistent bottom banner.
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('div');
    b.className = 'guest-banner';
    b.innerHTML =
      '<span class="guest-banner-text">Exploring as a guest — your notes &amp; habits stay in <b>this browser only</b>. Sign up to save them &amp; join the community.</span>' +
      '<a class="guest-banner-cta" href="/">Sign up</a>';
    document.body.appendChild(b);
    document.body.classList.add('has-guest-banner');
  });
})();
