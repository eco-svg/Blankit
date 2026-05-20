/* ═══════════════════════════════════════
   manifestation.js — atomic habits AI
═══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  const saved = localStorage.getItem('Eco-Svg-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  const goalInput     = document.getElementById('manifestGoal');
  const generateBtn   = document.getElementById('generateBtn');
  const planLoading   = document.getElementById('planLoading');
  const habitsSection = document.getElementById('habitsSection');
  const habitsLabel   = document.getElementById('habitsLabel');
  const habitsGrid    = document.getElementById('habitsGrid');
  const chatInput     = document.getElementById('chatInput');
  const chatSendBtn   = document.getElementById('chatSendBtn');
  const chatMessages  = document.getElementById('chatMessages');

  // store habits array here so buttons can access by index without attribute escaping issues
  let currentHabits = [];

  /* ══════════════════════════════
     SUGGEST HABITS
  ══════════════════════════════ */
  generateBtn?.addEventListener('click', fetchHabits);
  goalInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') fetchHabits();
  });

  async function fetchHabits() {
    const goal = goalInput?.value.trim();
    if (!goal) {
      goalInput.style.borderColor = '#c0392b';
      setTimeout(() => goalInput.style.borderColor = '', 1500);
      return;
    }

    generateBtn.disabled    = true;
    generateBtn.textContent = 'Thinking...';
    habitsGrid.innerHTML    = '';
    habitsSection.classList.add('hidden');
    planLoading.classList.remove('hidden');

    try {
      const res  = await fetch('/ai/suggest-habits', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ goal }),
      });
      const data = await res.json();

      planLoading.classList.add('hidden');

      if (!res.ok) {
        habitsGrid.innerHTML = `<p class="mf-error">${esc(data.error || 'AI unavailable — is Ollama running?')}</p>`;
        habitsSection.classList.remove('hidden');
        return;
      }

      if (data.habits && Array.isArray(data.habits) && data.habits.length > 0) {
        habitsLabel.textContent = `// atomic habits for: ${goal}`;
        currentHabits = data.habits;
        window._debugHabits = data.habits;
        renderHabits(data.habits);
        habitsSection.classList.remove('hidden');
      } else {
        habitsGrid.innerHTML = '<p class="mf-error">AI returned unexpected format. Try again.</p>';
        habitsSection.classList.remove('hidden');
      }

    } catch {
      planLoading.classList.add('hidden');
      habitsGrid.innerHTML = '<p class="mf-error">Network error — is Ollama running?</p>';
      habitsSection.classList.remove('hidden');
    } finally {
      generateBtn.disabled    = false;
      generateBtn.textContent = '✦ Suggest habits';
    }
  }

  function getField(h, ...keys) {
    for (const k of keys) {
      if (h[k]) return h[k];
    }
    return '';
  }

  function renderHabits(habits) {
    habitsGrid.innerHTML = habits.map((h, i) => {
      const name = getField(h, 'habit', 'name', 'title', 'Habit');
      const why  = getField(h, 'why', 'reason', 'description', 'Why');
      const freq = getField(h, 'frequency', 'Frequency', 'freq');
      const dur  = getField(h, 'duration', 'Duration', 'time');
      return `
        <div class="mf-habit-card">
          <div class="mf-habit-name">${esc(name)}</div>
          <p class="mf-habit-why">${esc(why)}</p>
          <div class="mf-habit-meta">
            ${freq ? `<span class="mf-habit-tag">⟳ ${esc(freq)}</span>` : ''}
            ${dur  ? `<span class="mf-habit-tag">⏱ ${esc(dur)}</span>`  : ''}
          </div>
          <button class="mf-add-btn" data-index="${i}">+ Add to tracker</button>
        </div>
      `;
    }).join('');

    habitsGrid.querySelectorAll('.mf-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i    = parseInt(btn.dataset.index);
        const h    = currentHabits[i];
        const name = getField(h, 'habit', 'name', 'title', 'Habit');
        addHabit(btn, name);
      });
    });
  }

  async function addHabit(btn, name) {
    if (!name) return;
    btn.disabled    = true;
    btn.textContent = 'Adding...';

    try {
      const res = await fetch('/api/habits', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, habit_type: 'manual' }),
      });

      if (res.ok) {
        btn.textContent = '✓ Added to home';
        btn.classList.add('added');
      } else {
        const data      = await res.json();
        btn.textContent = data.error || 'Failed';
        btn.disabled    = false;
      }
    } catch {
      btn.textContent = 'Error — try again';
      btn.disabled    = false;
    }
  }

  /* ══════════════════════════════
     CHAT
  ══════════════════════════════ */
  async function sendChat() {
    const message = chatInput?.value.trim();
    if (!message) return;

    appendMsg('you', message);
    chatInput.value      = '';
    chatSendBtn.disabled = true;

    const thinking = appendMsg('veyra', '...', true);

    try {
      const res  = await fetch('/ai/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message }),
      });
      const data = await res.json();
      thinking.remove();
      appendMsg('veyra', res.ok ? data.reply : (data.error || 'Something went wrong.'));
    } catch {
      thinking.remove();
      appendMsg('veyra', 'Network error — is Ollama running?');
    } finally {
      chatSendBtn.disabled = false;
      chatInput.focus();
    }
  }

  function appendMsg(sender, text, typing = false) {
    const el = document.createElement('div');
    el.className = `mf-msg mf-msg--${sender}${typing ? ' mf-msg--typing' : ''}`;
    el.innerHTML = `
      <span class="mf-msg-sender">${sender === 'you' ? 'you' : 'veyra ◈'}</span>
      <span class="mf-msg-text">${esc(text)}</span>
    `;
    chatMessages?.appendChild(el);
    chatMessages?.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
    return el;
  }

  chatSendBtn?.addEventListener('click', sendChat);
  chatInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

});