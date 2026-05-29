(function () {
  let habits = [];

  // ── Delete confirmation modal ─────────────────────────
  const delModal      = document.getElementById('deleteHabitModal');
  const delNameEl     = document.getElementById('deleteHabitName');
  const delCancelBtn  = document.getElementById('cancelDeleteHabitBtn');
  const delConfirmBtn = document.getElementById('confirmDeleteHabitBtn');
  let   pendingDeleteId = null;

  function openDeleteModal(id, name) {
    pendingDeleteId = id;
    if (delNameEl) delNameEl.textContent = `"${name}"`;
    delModal?.classList.remove('hidden');
  }
  delCancelBtn?.addEventListener('click',  () => { delModal?.classList.add('hidden'); pendingDeleteId = null; });
  delConfirmBtn?.addEventListener('click', () => {
    delModal?.classList.add('hidden');
    if (pendingDeleteId !== null) { _doDelete(pendingDeleteId); pendingDeleteId = null; }
  });
  window.addEventListener('click', e => { if (e.target === delModal) { delModal.classList.add('hidden'); pendingDeleteId = null; } });

  const flipBtn      = document.getElementById('habitFlipBtn');
  const flipBackBtn  = document.getElementById('habitFlipBackBtn');
  const addTrigger   = document.getElementById('habitAddTrigger');
  const addRow       = document.getElementById('habitAddRow');
  const addCancel    = document.getElementById('habitAddCancel');
  const habitInput   = document.getElementById('habitNameInput');
  const habitAddBtn  = document.getElementById('habitAddBtn');
  const manageList   = document.getElementById('habitManageList');
  const todayList    = document.getElementById('habitTodayList');
  const todayFooter  = document.getElementById('habitTodayFooter');
  const mobFooter    = document.getElementById('habitMobFooter');
  const todayDateEl  = document.getElementById('habitTodayDate');
  const faceFront    = document.getElementById('habitFaceFront');

  if (todayDateEl) {
    todayDateEl.textContent = new Date().toLocaleDateString('en', {
      weekday: 'short', month: 'short', day: 'numeric'
    });
  }

  // ── Mobile inner flip: manage ↔ today ─────────────────
  function flip(toBack) {
    if (!faceFront) return;
    faceFront.classList.toggle('flipped', toBack);
  }
  if (flipBtn)     flipBtn.addEventListener('click',     () => flip(true));
  if (flipBackBtn) flipBackBtn.addEventListener('click', () => flip(false));

  // ── Desktop add row: hidden until + clicked ───────────
  function openAdd() {
    if (!addRow) return;
    addRow.classList.add('visible');
    habitInput?.focus();
  }
  function closeAdd() {
    if (!addRow) return;
    addRow.classList.remove('visible');
    if (habitInput) habitInput.value = '';
  }
  if (addTrigger) addTrigger.addEventListener('click', openAdd);
  if (addCancel)  addCancel.addEventListener('click', closeAdd);

  // ── Load & render ─────────────────────────────────────
  async function loadHabits() {
    try {
      const res = await fetch('/pug/api/habits');
      if (!res.ok) return;
      habits = await res.json();
      renderManage();
      renderToday();
    } catch (e) {}
  }

  function isDesktop() { return window.innerWidth > 768; }

  function renderManage() {
    if (!manageList) return;
    if (!habits.length) {
      manageList.innerHTML = '<li class="habit-empty">No habits yet — add one above.</li>';
      renderFooter();
      return;
    }

    // Combined: check circle + name + delete (same on desktop and mobile)
    manageList.innerHTML = habits.map(h => `
      <li class="habit-combined-item${h.done_today ? ' done' : ''}" data-id="${h.id ?? ''}">
        <span class="habit-check">✓</span>
        <span class="habit-name">${h.name}</span>
        ${h.id != null
          ? `<button class="habit-del-btn" data-id="${h.id}" title="Remove">✕</button>`
          : `<span class="habit-saving">saving…</span>`}
      </li>`).join('');
    manageList.querySelectorAll('.habit-combined-item').forEach(li => {
      const id = +li.dataset.id;
      if (!id) return;
      li.addEventListener('click', e => {
        if (e.target.closest('.habit-del-btn')) return;
        toggleHabit(id);
      });
    });

    manageList.querySelectorAll('.habit-del-btn').forEach(btn =>
      btn.addEventListener('click', e => { e.stopPropagation(); deleteHabit(+btn.dataset.id); })
    );
    renderFooter();
  }

  // Mobile today panel (check + name)
  function renderToday() {
    if (!todayList) return;
    const confirmed = habits.filter(h => h.id != null);
    if (!confirmed.length) {
      todayList.innerHTML = '<li class="habit-empty">Add habits on the left.</li>';
      renderFooter();
      return;
    }
    todayList.innerHTML = confirmed.map(h => `
      <li class="habit-today-item${h.done_today ? ' done' : ''}" data-id="${h.id}">
        <span class="habit-check">${h.done_today ? '✓' : ''}</span>
        <span class="habit-name">${h.name}</span>
      </li>`).join('');
    todayList.querySelectorAll('.habit-today-item').forEach(li =>
      li.addEventListener('click', () => toggleHabit(+li.dataset.id))
    );
    renderFooter();
  }

  function renderFooter() {
    const confirmed = habits.filter(h => h.id != null);
    const done  = confirmed.filter(h => h.done_today).length;
    const total = confirmed.length;
    const pct   = total ? Math.round(done / total * 100) : 0;
    const html  = total ? `
      <div class="habit-progress-wrap">
        <div class="habit-progress-bar" style="width:${pct}%"></div>
      </div>
      <span class="habit-progress-label">${done} / ${total} done today${pct === 100 ? ' — all done!' : ''}</span>
    ` : '';
    if (todayFooter) todayFooter.innerHTML = html;
    if (mobFooter)   mobFooter.innerHTML   = html;
  }

  // ── Add (optimistic) ──────────────────────────────────
  async function addHabit() {
    const name = (habitInput?.value || '').trim();
    if (!name) return;
    habitInput.value = '';
    closeAdd();
    const temp = { id: null, name, done_today: false };
    habits.push(temp);
    renderManage();
    renderToday();
    try {
      const res = await fetch('/pug/api/habits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        const data = await res.json();
        temp.id = data.id;
        temp.done_today = data.done_today ?? false;
      } else {
        habits = habits.filter(h => h !== temp);
      }
    } catch (e) {
      habits = habits.filter(h => h !== temp);
    }
    renderManage();
    renderToday();
  }
  if (habitAddBtn) habitAddBtn.addEventListener('click', addHabit);
  if (habitInput)  habitInput.addEventListener('keypress', e => { if (e.key === 'Enter') addHabit(); });

  // ── Delete ────────────────────────────────────────────
  function deleteHabit(id) {
    const habit = habits.find(h => h.id === id);
    openDeleteModal(id, habit ? habit.name : 'this habit');
  }

  async function _doDelete(id) {
    habits = habits.filter(h => h.id !== id);
    renderManage();
    renderToday();
    try {
      await fetch(`/pug/api/habits/${id}`, { method: 'DELETE' });
    } catch (e) {
      await loadHabits();
    }
  }

  // ── Toggle ────────────────────────────────────────────
  async function toggleHabit(id) {
    const h = habits.find(x => x.id === id);
    if (!h) return;
    h.done_today = !h.done_today;
    renderManage();
    renderToday();
    try {
      const res = await fetch(`/pug/api/habits/${id}/toggle`, { method: 'POST' });
      if (!res.ok) { h.done_today = !h.done_today; renderManage(); renderToday(); return; }
      const data = await res.json();
      h.done_today = data.done;
      renderManage();
      renderToday();
      window.dispatchEvent(new Event('habitUpdated'));
    } catch (e) { h.done_today = !h.done_today; renderManage(); renderToday(); }
  }

  loadHabits();
})();
