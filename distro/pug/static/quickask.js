/*
 * quickask.js — wires the home "Quick Ask" card (#sec-blinkbot in _notes.html)
 * to the Groq cloud model via /pug/api/quickask. The card markup existed but was
 * never hooked up, so sending a message did nothing ("no response").
 */
document.addEventListener('DOMContentLoaded', () => {
  const input  = document.getElementById('mainGroqInput');
  const sendBtn = document.getElementById('mainGroqSendBtn');
  const msgs    = document.getElementById('mainGroqMessages');
  const clearBtn = document.getElementById('mainGroqClearBtn');
  if (!input || !sendBtn || !msgs) return;

  const history = [];        // [{role:'user'|'assistant', content}]
  let busy = false;

  function clearPlaceholder() {
    const ph = msgs.querySelector('.qa-placeholder');
    if (ph) ph.remove();
  }

  function bubble(role, text) {
    const el = document.createElement('div');
    el.className = 'qa-msg qa-' + role;
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  async function send() {
    const message = (input.value || '').trim();
    if (!message || busy) return;
    busy = true;
    input.value = '';
    clearPlaceholder();
    bubble('user', message);
    history.push({ role: 'user', content: message });

    const thinking = bubble('bot', 'Thinking…');
    thinking.classList.add('qa-thinking');

    try {
      const res = await fetch('/pug/api/quickask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message, history: history.slice(-10) }),
      });
      const data = await res.json().catch(() => ({}));
      const reply = (data && data.reply) ? data.reply
                  : "Quick Ask is unavailable right now — try again in a moment.";
      thinking.classList.remove('qa-thinking');
      thinking.textContent = reply;
      history.push({ role: 'assistant', content: reply });
    } catch (err) {
      if (window.blinkLog) window.blinkLog('quickask', err);
      thinking.classList.remove('qa-thinking');
      thinking.textContent = "Couldn't reach Quick Ask — check your connection and retry.";
    } finally {
      busy = false;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      history.length = 0;
      msgs.innerHTML = '<div class="qa-placeholder" style="color:var(--text-dim);opacity:0.35;font-size:0.74rem;">Ask anything…</div>';
    });
  }
});
