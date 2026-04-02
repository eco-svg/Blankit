/* ═══════════════════════════════════════════
   calendar.js — ecosvg habit tracker
   ═══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ══════════════════════════════
     STATE
     ══════════════════════════════ */
  const TODAY     = new Date();
  TODAY.setHours(0,0,0,0);

  let currentMonth = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  let miniMonth    = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  let selectedDate = new Date(TODAY);
  let currentView  = 'monthly'; // 'monthly' | 'weekly'
  let weekStart    = getWeekStart(TODAY);
  let selectedPriority = 'medium';

  // Mock habit data — replace with real data when backend ready
  const HABITS = [
    { id: 'walk',  name: 'Morning walk' },
    { id: 'water', name: 'Drink 2L water' },
    { id: 'read',  name: 'Read 20 pages' },
    { id: 'push',  name: '10 push-ups' },
    { id: 'med',   name: 'Meditate' },
  ];

  // Mock habit completion — random for demo
  function getHabitCompletion(dateKey) {
    // seed random based on date so it's stable per session
    const seed = dateKey.split('-').reduce((a, b) => a + parseInt(b), 0);
    return HABITS.map((h, i) => ({ ...h, done: ((seed + i * 7) % 3) !== 0 }));
  }

  /* ══════════════════════════════
     STORAGE
     ══════════════════════════════ */
  const TODOS_KEY = 'ecosvg-todos';

  function loadTodos() {
    try { return JSON.parse(localStorage.getItem(TODOS_KEY)) || {}; }
    catch { return {}; }
  }

  function saveTodos(todos) {
    localStorage.setItem(TODOS_KEY, JSON.stringify(todos));
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function getTodosForDate(date) {
    return loadTodos()[dateKey(date)] || [];
  }

  function setTodosForDate(date, todos) {
    const all = loadTodos();
    all[dateKey(date)] = todos;
    saveTodos(all);
  }

  /* ══════════════════════════════
     HELPERS
     ══════════════════════════════ */
  function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun
    const diff = (day === 0) ? -6 : 1 - day; // Mon start
    d.setDate(d.getDate() + diff);
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

  const MONTH_NAMES = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];
  const SHORT_DAYS  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

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
    const label = document.getElementById('miniMonthLabel');
    label.textContent = `${MONTH_NAMES[miniMonth.getMonth()]} ${miniMonth.getFullYear()}`;

    const container = document.getElementById('miniCalDays');
    container.innerHTML = '';

    const year  = miniMonth.getFullYear();
    const month = miniMonth.getMonth();
    const first = new Date(year, month, 1);
    const last  = new Date(year, month + 1, 0);

    // Monday-start offset
    let startDow = first.getDay(); // 0=Sun
    startDow = (startDow === 0) ? 6 : startDow - 1;

    const todos = loadTodos();

    // prev month filler
    for (let i = 0; i < startDow; i++) {
      const d = new Date(year, month, -startDow + i + 1);
      const el = makeMiniDay(d, true, todos);
      container.appendChild(el);
    }
    // current month
    for (let d = 1; d <= last.getDate(); d++) {
      const date = new Date(year, month, d);
      const el = makeMiniDay(date, false, todos);
      container.appendChild(el);
    }
    // next month filler
    const total = startDow + last.getDate();
    const remainder = (7 - (total % 7)) % 7;
    for (let i = 1; i <= remainder; i++) {
      const d = new Date(year, month + 1, i);
      const el = makeMiniDay(d, true, todos);
      container.appendChild(el);
    }
  }

  function makeMiniDay(date, otherMonth, todos) {
    const el = document.createElement('div');
    el.className = 'mini-day';
    el.textContent = date.getDate();
    if (otherMonth) el.classList.add('other-month');
    if (isSameDay(date, TODAY)) el.classList.add('today');
    if (isSameDay(date, selectedDate)) el.classList.add('selected');
    const key = dateKey(date);
    if (todos[key] && todos[key].length > 0) el.classList.add('has-todos');
    el.addEventListener('click', () => selectDate(date));
    return el;
  }

  document.getElementById('miniPrev').addEventListener('click', () => {
    miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() - 1, 1);
    renderMini();
  });
  document.getElementById('miniNext').addEventListener('click', () => {
    miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() + 1, 1);
    renderMini();
  });

  /* ══════════════════════════════
     DAY DETAIL
     ══════════════════════════════ */
  function renderDayDetail() {
    document.getElementById('dayDetailDate').textContent = formatDateLabel(selectedDate);

    // habit dots
    const dotsWrap = document.getElementById('dayHabitDots');
    dotsWrap.innerHTML = '';
    const habits = getHabitCompletion(dateKey(selectedDate));
    habits.forEach(h => {
      const dot = document.createElement('div');
      dot.className = `habit-dot${h.done ? ' done' : ''}`;
      dot.innerHTML = `<div class="habit-dot-circle"></div><span>${h.name}</span>`;
      dotsWrap.appendChild(dot);
    });

    renderTodoList();
  }

  function renderTodoList() {
    const todos   = getTodosForDate(selectedDate);
    const list    = document.getElementById('todoList');
    const empty   = document.getElementById('todoEmpty');
    list.innerHTML = '';

    if (todos.length === 0) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    todos.forEach((todo, idx) => {
      const li = document.createElement('li');
      li.className = `todo-item${todo.done ? ' done' : ''}`;
      li.innerHTML = `
        <button class="todo-check">${todo.done ? '✓' : ''}</button>
        <div class="todo-priority ${todo.priority}"></div>
        <span class="todo-text">${todo.text}</span>
        <button class="todo-delete" title="Delete">✕</button>
      `;
      li.querySelector('.todo-check').addEventListener('click', () => toggleTodo(idx));
      li.querySelector('.todo-delete').addEventListener('click', () => deleteTodo(idx));
      list.appendChild(li);
    });

    // refresh calendar cells too
    if (currentView === 'monthly') renderMonthly();
    else renderWeekly();
    renderMini();
  }

  function toggleTodo(idx) {
    const todos = getTodosForDate(selectedDate);
    todos[idx].done = !todos[idx].done;
    setTodosForDate(selectedDate, todos);
    renderTodoList();
  }

  function deleteTodo(idx) {
    const todos = getTodosForDate(selectedDate);
    todos.splice(idx, 1);
    setTodosForDate(selectedDate, todos);
    renderTodoList();
  }

  /* ══════════════════════════════
     SELECT DATE
     ══════════════════════════════ */
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

    document.getElementById('mainMonthLabel').textContent =
      `${MONTH_NAMES[month]} ${year}`;

    const grid = document.getElementById('mainCalGrid');
    grid.innerHTML = '';

    const first = new Date(year, month, 1);
    const last  = new Date(year, month + 1, 0);
    let startDow = first.getDay();
    startDow = (startDow === 0) ? 6 : startDow - 1;

    const todos = loadTodos();

    // prev month filler
    for (let i = 0; i < startDow; i++) {
      const d = new Date(year, month, -startDow + i + 1);
      grid.appendChild(makeMainDay(d, true, todos));
    }
    // days
    for (let d = 1; d <= last.getDate(); d++) {
      const date = new Date(year, month, d);
      grid.appendChild(makeMainDay(date, false, todos));
    }
    // filler
    const total = startDow + last.getDate();
    const rem   = (7 - (total % 7)) % 7;
    for (let i = 1; i <= rem; i++) {
      const d = new Date(year, month + 1, i);
      grid.appendChild(makeMainDay(d, true, todos));
    }
  }

  function makeMainDay(date, otherMonth, todos) {
    const el = document.createElement('div');
    el.className = 'main-day';
    if (otherMonth) el.classList.add('other-month');
    if (isSameDay(date, TODAY)) el.classList.add('today');
    if (isSameDay(date, selectedDate)) el.classList.add('selected');

    const key       = dateKey(date);
    const dayTodos  = todos[key] || [];
    const habits    = getHabitCompletion(key);

    // day number
    const numEl = document.createElement('div');
    numEl.className = 'main-day-num';
    numEl.textContent = date.getDate();
    el.appendChild(numEl);

    // todo chips (max 3)
    const todosWrap = document.createElement('div');
    todosWrap.className = 'main-day-todos';
    dayTodos.slice(0, 3).forEach(t => {
      const chip = document.createElement('div');
      chip.className = `main-day-chip ${t.priority}${t.done ? ' done' : ''}`;
      chip.textContent = t.text;
      todosWrap.appendChild(chip);
    });
    if (dayTodos.length > 3) {
      const more = document.createElement('div');
      more.className = 'main-day-more';
      more.textContent = `+${dayTodos.length - 3} more`;
      todosWrap.appendChild(more);
    }
    el.appendChild(todosWrap);

    // habit dots
    const dotsWrap = document.createElement('div');
    dotsWrap.className = 'main-day-dots';
    habits.forEach(h => {
      const dot = document.createElement('div');
      dot.className = `main-day-dot${h.done ? ' done' : ''}`;
      dot.title = h.name;
      dotsWrap.appendChild(dot);
    });
    el.appendChild(dotsWrap);

    el.addEventListener('click', () => {
      selectDate(date);
      // sync month if clicking filler day
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
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    renderMonthly();
  });
  document.getElementById('mainNext').addEventListener('click', () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    renderMonthly();
  });

  /* ══════════════════════════════
     WEEKLY VIEW
     ══════════════════════════════ */
  function renderWeekly() {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);

    const startM = MONTH_NAMES[weekStart.getMonth()];
    const endM   = MONTH_NAMES[end.getMonth()];
    const label  = startM === endM
      ? `${startM} ${weekStart.getDate()}–${end.getDate()}, ${weekStart.getFullYear()}`
      : `${startM} ${weekStart.getDate()} – ${endM} ${end.getDate()}, ${weekStart.getFullYear()}`;

    document.getElementById('weekLabel').textContent = label;

    const grid  = document.getElementById('weekGrid');
    grid.innerHTML = '';
    const todos = loadTodos();

    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);

      const key      = dateKey(date);
      const dayTodos = todos[key] || [];
      const habits   = getHabitCompletion(key);

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
        <div class="week-day-dots"></div>
      `;

      const todosWrap = col.querySelector('.week-day-todos');
      dayTodos.forEach(t => {
        const chip = document.createElement('div');
        chip.className = `week-chip ${t.priority}${t.done ? ' done' : ''}`;
        chip.textContent = t.text;
        todosWrap.appendChild(chip);
      });

      const dotsWrap = col.querySelector('.week-day-dots');
      habits.forEach(h => {
        const dot = document.createElement('div');
        dot.className = `week-dot${h.done ? ' done' : ''}`;
        dot.title = h.name;
        dotsWrap.appendChild(dot);
      });

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
  const todoModal        = document.getElementById('todoModal');
  const todoModalBackdrop= document.getElementById('todoModalBackdrop');
  const todoInput        = document.getElementById('todoInput');
  const todoModalSave    = document.getElementById('todoModalSave');
  const todoModalClose   = document.getElementById('todoModalClose');

  function openTodoModal() {
    todoInput.value = '';
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

  // priority buttons
  document.querySelectorAll('.priority-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedPriority = btn.dataset.priority;
      document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // save todo
  todoModalSave.addEventListener('click', saveTodo);
  todoInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveTodo(); });

  function saveTodo() {
    const text = todoInput.value.trim();
    if (!text) return;
    const todos = getTodosForDate(selectedDate);
    todos.push({ text, priority: selectedPriority, done: false });
    setTodosForDate(selectedDate, todos);
    renderTodoList();
    renderDayDetail();
    closeTodoModal();
  }

  /* ══════════════════════════════
     INITIAL RENDER
     ══════════════════════════════ */
  renderMini();
  renderMonthly();
  renderDayDetail();

});