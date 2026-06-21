/**
 * quickactions.js — the Quick Actions sidebar card. For now: one minimal focus timer.
 *   • Set the minutes (1–180): CLICK the time to edit (it highlights), then TYPE the
 *     number or SCROLL over it. Enter commits.
 *   • Use the Start / Pause button to run it (clicking the time no longer starts it —
 *     that was the confusing part).
 *   • At zero it dings, then keeps ticking into the NEGATIVE (overtime, red) until reset.
 * Kept deliberately tiny; more quick actions will share this card later.
 */
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var display = document.getElementById('qaTimerDisplay');
    var reset   = document.getElementById('qaTimerReset');
    var toggleBtn = document.getElementById('qaTimerToggle');
    if (!display) return;

    var setSec    = 5 * 60;    // configured duration (default 5 min)
    var remaining = setSec;    // counts down; may go negative (overtime)
    var running   = false;
    var endAt     = 0;
    var tick      = null;
    var dinged    = false;
    var typing    = '';        // keyboard-entry digit buffer (minutes)

    function fmt(s) {
      var neg = s < 0;
      s = Math.abs(Math.round(s));
      var m = Math.floor(s / 60), sec = s % 60;
      return (neg ? '-' : '') + (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
    }
    function render() {
      display.textContent = fmt(remaining);
      display.classList.toggle('qa-overtime', remaining < 0);
    }
    function setMinutes(m) {
      m = Math.max(1, Math.min(180, m | 0));
      setSec = m * 60; remaining = setSec; dinged = false; render();
    }
    function previewMinutes(m) {            // show while typing without clamping to 1
      m = Math.min(180, m | 0);
      setSec = m * 60; remaining = setSec; render();
    }
    function commitTyping() {
      if (!typing) return;
      setMinutes(parseInt(typing, 10) || 1);
      typing = '';
    }
    function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

    function syncBtn() { if (toggleBtn) toggleBtn.textContent = running ? 'Pause' : 'Start'; }
    function start() {
      commitTyping();
      display.blur(); display.classList.remove('qa-editing');
      running = true;
      display.classList.add('qa-running');
      endAt = Date.now() + remaining * 1000;
      tick = setInterval(function () {
        remaining = (endAt - Date.now()) / 1000;
        if (remaining <= 0 && !dinged) { dinged = true; ding(); }
        render();
      }, 200);
      syncBtn();
    }
    function pause() { running = false; display.classList.remove('qa-running'); stopTick(); syncBtn(); }
    function ding() {
      beep();
      display.classList.add('qa-timer-done');
      setTimeout(function () { display.classList.remove('qa-timer-done'); }, 1500);
      if (window.Notification && Notification.permission === 'granted') {
        try { new Notification('Time’s up', { body: 'Focus timer hit zero — now in overtime.' }); } catch (e) {}
      }
    }
    function beep() {
      try {
        var ac = new (window.AudioContext || window.webkitAudioContext)();
        var o = ac.createOscillator(), g = ac.createGain();
        o.connect(g); g.connect(ac.destination);
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.001, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.6);
        o.start(); o.stop(ac.currentTime + 0.62);
      } catch (e) {}
    }

    function toggle() {
      running ? pause() : start();
      if (window.Notification && Notification.permission === 'default') {
        try { Notification.requestPermission(); } catch (e) {}
      }
    }

    // Clicking the time EDITS it (focus + highlight) — it no longer starts the timer.
    display.addEventListener('click', function () { if (!running) { display.focus(); } });
    display.addEventListener('focus', function () { if (!running) { typing = ''; display.classList.add('qa-editing'); } });
    display.addEventListener('blur', function () { commitTyping(); display.classList.remove('qa-editing'); });
    display.addEventListener('keydown', function (e) {
      // Type a number to set the minutes (only while stopped / editing).
      if (!running && e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        typing = (typing + e.key).slice(-3);
        previewMinutes(parseInt(typing, 10) || 0);
        return;
      }
      if (!running && e.key === 'Backspace') {
        e.preventDefault();
        typing = typing.slice(0, -1);
        previewMinutes(parseInt(typing || '0', 10));
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); commitTyping(); display.blur(); return; }  // commit, don't auto-start
      if (e.key === 'Escape') { e.preventDefault(); display.blur(); }
    });
    if (toggleBtn) toggleBtn.addEventListener('click', toggle);

    // Scroll over the digits to set the minutes (only while stopped).
    display.addEventListener('wheel', function (e) {
      if (running) return;
      e.preventDefault();
      typing = '';
      setMinutes(Math.round(setSec / 60) + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });

    if (reset) reset.addEventListener('click', function () { pause(); typing = ''; remaining = setSec; dinged = false; render(); });

    render();
  });
})();
