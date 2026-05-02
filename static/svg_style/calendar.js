/* ═══════════════════════════════════════════
   calendar.js — real API data per user
   Todos saved to DB, habits from API
   ═══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {

  /* ── THEME ── */
  const saved = localStorage.getItem('ecosvg-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  /* ══════════════════════════════
     STATE
     ══════════════════════════════ */
  const TODAY     = new Date();
  TODAY.setHours(0,0,0,0);

  let currentMonth     = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  let miniMonth        = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  let selectedDate     = new Date(TODAY);
  let currentView      = 'monthly';
  let weekStart        = getWeekStart(TODAY);
  let selectedPriority = 'medium';
  let habits           = [];
  let yearlyData       = [];
  let todosCache       = {};

  /* ══════════════════════════════
     FETCH HABITS + YEARLY DATA
     ══════════════════════════════ */
  async function init() {
    try {
      const [hRes, yRes] = await Promise.all([
        fetch('/api/habits'),
        fetch('/api/stats/yearly'),
      ]);
      habits     = await hRes.json();
      yearlyData = await yRes.json();
    } catch(e) {
      console.error('Calendar init failed', e);
    }
    renderMini();
    renderMonthly();
    renderDayDetail();
  }

  /* ══════════════════════════════
     HELPERS
     ══════════════════════════════ */
  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function getWeekStart(date) {
    const d   = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    d.setHours(0,0,0,0);
    return d;
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth()    === b.getMonth()    &&
           a.getDate()     === b.getDate();
  }

  function formatDateLabel(date) {
    const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }

  function getLevelForDate(key) {
    const entry = yearlyData.find(d => d.date === key);
    return entry ? entry.level : 0;
  }

  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
  const SHORT_DAYS  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  /* ══════════════════════════════
     TODOS — API
     ══════════════════════════════ */
  async function fetchTodos(date) {
    const key = dateKey(date);
    if (todosCache[key]) return todosCache[key];
    try {
      const res  = await fetch(`/api/todos/${key}`);
      const data = await res.json();
      todosCache[key] = data;
      return data;
    } catch(e) {
      return [];
    }
  }

  async function addTodo(date, text, priority) {
    const key = dateKey(date);
    try {
      const res  = await fetch(`/api/todos/${key}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text, priority }),
      });
      const todo = await res.json();
      todosCache[key] = [...(todosCache[key] || []), todo];
      return todo;
    } catch(e) { return null; }
  }

  async function toggleTodoApi(todoId, date) {
    const key = dateKey(date);
    try {
      const res  = await fetch(`/api/todos/item/${todoId}/toggle`, { method:'POST' });
      const todo = await res.json();
      todosCache[key] = (todosCache[key] || []).map(t => t.id === todoId ? todo : t);
    } catch(e) { console.error(e); }
  }

  async function deleteTodoApi(todoId, date) {
    const key = dateKey(date);
    try {
      await fetch(`/api/todos/item/${todoId}`, { method:'DELETE' });
      todosCache[key] = (todosCache[key] || []).filter(t => t.id !== todoId);
    } catch(e) { console.error(e); }
  }

  /* ══════════════════════════════
     VIEW TOGGLE
     ══════════════════════════════ */
  document.getElementById('btnMonthly').addEventListener('click', () => {
    currentView = 'monthly';
    document.getElementById('btnMonthly').classList.add('active');
    document.getElementById('btnWeekly').classList.remove('active');
    document.getElementById('viewMonthly').classList.remove('hidden');
    document.getElementById('viewWeekly').classList.add('hidden');
    renderMonthly();
  });

  document.getElementById('btnWeekly').addEventListener('click', () => {
    currentView = 'weekly';
    document.getElementById('btnWeekly').classList.add('active');
    document.getElementById('btnMonthly').classList.remove('active');
    document.getElementById('viewWeekly').classList.remove('hidden');
    document.getElementById('viewMonthly').classList.add('hidden');
    weekStart = getWeekStart(selectedDate);
    renderWeekly();
  });

  /* ══════════════════════════════
     MINI CALENDAR
     ══════════════════════════════ */
  function renderMini() {
    document.getElementById('miniMonthLabel').textContent =
      `${MONTH_NAMES[miniMonth.getMonth()]} ${miniMonth.getFullYear()}`;

    const container = document.getElementById('miniCalDays');
    container.innerHTML = '';

    const year  = miniMonth.getFullYear();
    const month = miniMonth.getMonth();
    const first = new Date(year, month, 1);
    const last  = new Date(year, month+1, 0);
    let startDow = first.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1;

    for (let i = 0; i < startDow; i++) {
      container.appendChild(makeMiniDay(new Date(year, month, -startDow+i+1), true));
    }
    for (let d = 1; d <= last.getDate(); d++) {
      container.appendChild(makeMiniDay(new Date(year, month, d), false));
    }
    const total = startDow + last.getDate();
    const rem   = (7 - (total % 7)) % 7;
    for (let i = 1; i <= rem; i++) {
      container.appendChild(makeMiniDay(new Date(year, month+1, i), true));
    }
  }

  function makeMiniDay(date, otherMonth) {
    const el = document.createElement('div');
    el.className = 'mini-day';
    el.textContent = date.getDate();
    if (otherMonth)              el.classList.add('other-month');
    if (isSameDay(date, TODAY))  el.classList.add('today');
    if (isSameDay(date, selectedDate)) el.classList.add('selected');
    const key   = dateKey(date);
    const level = getLevelForDate(key);
    if (level > 0) el.classList.add('has-todos');
    el.addEventListener('click', () => selectDate(date));
    return el;
  }

  document.getElementById('miniPrev').addEventListener('click', () => {
    miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth()-1, 1);
    renderMini();
  });
  document.getElementById('miniNext').addEventListener('click', () => {
    miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth()+1, 1);
    renderMini();
  });

  /* ══════════════════════════════
     DAY DETAIL
     ══════════════════════════════ */
  async function renderDayDetail() {
    document.getElementById('dayDetailDate').textContent = formatDateLabel(selectedDate);

    // habit dots from yearlyData level
    const dotsWrap = document.getElementById('dayHabitDots');
    dotsWrap.innerHTML = '';
    habits.forEach(h => {
      const dot = document.createElement('div');
      dot.className = 'habit-dot';
      dot.innerHTML = `<div class="habit-dot-circle"></div><span>${h.name}</span>`;
      dotsWrap.appendChild(dot);
    });

    await renderTodoList();
  }

  async function renderTodoList() {
    const todos = await fetchTodos(selectedDate);
    const list  = document.getElementById('todoList');
    const empty = document.getElementById('todoEmpty');
    list.innerHTML = '';

    if (!todos.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    todos.forEach(todo => {
      const li = document.createElement('li');
      li.className = `todo-item${todo.done ? ' done' : ''}`;
      li.innerHTML = `
        <button class="todo-check">${todo.done ? '✓' : ''}</button>
        <div class="todo-priority ${todo.priority}"></div>
        <span class="todo-text">${todo.text}</span>
        <button class="todo-delete" title="Delete">✕</button>`;

      li.querySelector('.todo-check').addEventListener('click', async () => {
        await toggleTodoApi(todo.id, selectedDate);
        await renderTodoList();
        if (currentView === 'monthly') renderMonthly();
        else renderWeekly();
        renderMini();
      });

      li.querySelector('.todo-delete').addEventListener('click', async () => {
        await deleteTodoApi(todo.id, selectedDate);
        await renderTodoList();
        if (currentView === 'monthly') renderMonthly();
        else renderWeekly();
        renderMini();
      });

      list.appendChild(li);
    });
  }

  function selectDate(date) {
    selectedDate = new Date(date);
    selectedDate.setHours(0,0,0,0);
    renderDayDetail();
    renderMini();
    if (currentView === 'monthly') renderMonthly();
    else renderWeekly();
  }

  /* ══════════════════════════════
     MONTHLY VIEW
     ══════════════════════════════ */
  function renderMonthly() {
    const year  = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    document.getElementById('mainMonthLabel').textContent = `${MONTH_NAMES[month]} ${year}`;

    const grid = document.getElementById('mainCalGrid');
    grid.innerHTML = '';

    const first = new Date(year, month, 1);
    const last  = new Date(year, month+1, 0);
    let startDow = first.getDay();
    startDow = startDow === 0 ? 6 : startDow - 1;

    for (let i = 0; i < startDow; i++) {
      grid.appendChild(makeMainDay(new Date(year, month, -startDow+i+1), true));
    }
    for (let d = 1; d <= last.getDate(); d++) {
      grid.appendChild(makeMainDay(new Date(year, month, d), false));
    }
    const total = startDow + last.getDate();
    const rem   = (7 - (total % 7)) % 7;
    for (let i = 1; i <= rem; i++) {
      grid.appendChild(makeMainDay(new Date(year, month+1, i), true));
    }
  }

  function makeMainDay(date, otherMonth) {
    const el = document.createElement('div');
    el.className = 'main-day';
    if (otherMonth)              el.classList.add('other-month');
    if (isSameDay(date, TODAY))  el.classList.add('today');
    if (isSameDay(date, selectedDate)) el.classList.add('selected');

    const key   = dateKey(date);
    const level = getLevelForDate(key);
    const cached = todosCache[key] || [];

    const numEl = document.createElement('div');
    numEl.className   = 'main-day-num';
    numEl.textContent = date.getDate();
    el.appendChild(numEl);

    const todosWrap = document.createElement('div');
    todosWrap.className = 'main-day-todos';
    cached.slice(0,3).forEach(t => {
      const chip = document.createElement('div');
      chip.className   = `main-day-chip ${t.priority}${t.done ? ' done' : ''}`;
      chip.textContent = t.text;
      todosWrap.appendChild(chip);
    });
    if (cached.length > 3) {
      const more = document.createElement('div');
      more.className   = 'main-day-more';
      more.textContent = `+${cached.length - 3} more`;
      todosWrap.appendChild(more);
    }
    el.appendChild(todosWrap);

    // habit completion dots from yearly heatmap level
    const dotsWrap = document.createElement('div');
    dotsWrap.className = 'main-day-dots';
    if (level > 0) {
      const dot = document.createElement('div');
      dot.className = 'main-day-dot done';
      dot.title     = `${level * 25}% complete`;
      dotsWrap.appendChild(dot);
    }
    el.appendChild(dotsWrap);

    el.addEventListener('click', () => {
      selectDate(date);
      if (otherMonth) {
        currentMonth = new Date(date.getFullYear(), date.getMonth(), 1);
        miniMonth    = new Date(currentMonth);
        renderMonthly();
        renderMini();
      }
    });

    return el;
  }

  document.getElementById('mainPrev').addEventListener('click', () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth()-1, 1);
    renderMonthly();
  });
  document.getElementById('mainNext').addEventListener('click', () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth()+1, 1);
    renderMonthly();
  });

  /* ══════════════════════════════
     WEEKLY VIEW
     ══════════════════════════════ */
  function renderWeekly() {
    const end    = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    const startM = MONTH_NAMES[weekStart.getMonth()];
    const endM   = MONTH_NAMES[end.getMonth()];
    const label  = startM === endM
      ? `${startM} ${weekStart.getDate()}–${end.getDate()}, ${weekStart.getFullYear()}`
      : `${startM} ${weekStart.getDate()} – ${endM} ${end.getDate()}, ${weekStart.getFullYear()}`;

    document.getElementById('weekLabel').textContent = label;

    const grid = document.getElementById('weekGrid');
    grid.innerHTML = '';

    for (let i = 0; i < 7; i++) {
      const date  = new Date(weekStart);
      date.setDate(date.getDate() + i);
      const key    = dateKey(date);
      const cached = todosCache[key] || [];
      const level  = getLevelForDate(key);

      const col = document.createElement('div');
      col.className = 'week-day';
      if (isSameDay(date, TODAY)) col.classList.add('today');
      if (isSameDay(date, selectedDate)) col.classList.add('selected');

      col.innerHTML = `
        <div class="week-day-head">
          <span class="week-day-name">${SHORT_DAYS[i]}</span>
          <span class="week-day-num">${date.getDate()}</span>
        </div>
        <div class="week-day-todos"></div>
        <div class="week-day-dots"></div>`;

      const todosWrap = col.querySelector('.week-day-todos');
      cached.forEach(t => {
        const chip = document.createElement('div');
        chip.className   = `week-chip ${t.priority}${t.done ? ' done' : ''}`;
        chip.textContent = t.text;
        todosWrap.appendChild(chip);
      });

      const dotsWrap = col.querySelector('.week-day-dots');
      if (level > 0) {
        const dot = document.createElement('div');
        dot.className = 'week-dot done';
        dot.title     = `${level * 25}% habits done`;
        dotsWrap.appendChild(dot);
      }

      col.addEventListener('click', () => selectDate(date));
      grid.appendChild(col);
    }
  }

  document.getElementById('weekPrev').addEventListener('click', () => {
    weekStart = new Date(weekStart);
    weekStart.setDate(weekStart.getDate() - 7);
    renderWeekly();
  });
  document.getElementById('weekNext').addEventListener('click', () => {
    weekStart = new Date(weekStart);
    weekStart.setDate(weekStart.getDate() + 7);
    renderWeekly();
  });

  /* ══════════════════════════════
     ADD TODO MODAL
     ══════════════════════════════ */
  const todoModal         = document.getElementById('todoModal');
  const todoModalBackdrop = document.getElementById('todoModalBackdrop');
  const todoInput         = document.getElementById('todoInput');
  const todoModalSave     = document.getElementById('todoModalSave');
  const todoModalClose    = document.getElementById('todoModalClose');

  function openTodoModal() {
    todoInput.value  = '';
    selectedPriority = 'medium';
    document.querySelectorAll('.priority-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.priority === 'medium');
    });
    todoModal.classList.remove('hidden');
    todoModalBackdrop.classList.remove('hidden');
    setTimeout(() => todoInput.focus(), 50);
  }

  function closeTodoModal() {
    todoModal.classList.add('hidden');
    todoModalBackdrop.classList.add('hidden');
  }

  document.getElementById('addTodoBtn').addEventListener('click', openTodoModal);
  todoModalClose.addEventListener('click', closeTodoModal);
  todoModalBackdrop.addEventListener('click', closeTodoModal);

  document.querySelectorAll('.priority-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedPriority = btn.dataset.priority;
      document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  async function saveTodo() {
    const text = todoInput.value.trim();
    if (!text) return;
    await addTodo(selectedDate, text, selectedPriority);
    await renderTodoList();
    if (currentView === 'monthly') renderMonthly();
    else renderWeekly();
    renderMini();
    closeTodoModal();
  }

  todoModalSave.addEventListener('click', saveTodo);
  todoInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveTodo(); });

  /* ── INIT ── */
  await init();
});