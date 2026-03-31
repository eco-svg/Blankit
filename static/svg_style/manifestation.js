/* ═══════════════════════════════════════════
   manifestation.js — ecosvg
   Goal → AI habit generator (frontend only)
   ═══════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── ELEMENTS ── */
  const goalInput     = document.getElementById('goalInput');
  const charCount     = document.getElementById('charCount');
  const timelineBtns  = document.getElementById('timelineBtns');
  const submitGoal    = document.getElementById('submitGoal');
  const stepGoal      = document.getElementById('stepGoal');
  const stepLoading   = document.getElementById('stepLoading');
  const stepResults   = document.getElementById('stepResults');
  const habitsGrid    = document.getElementById('habitsGrid');
  const resultsGoalPill = document.getElementById('resultsGoalPill');
  const resultsSub    = document.getElementById('resultsSub');
  const addAllBtn     = document.getElementById('addAllBtn');
  const regenerateBtn = document.getElementById('regenerateBtn');
  const newGoalBtn    = document.getElementById('newGoalBtn');
  const loadingText   = document.getElementById('loadingText');

  let selectedTimeline = '3 months';
  let currentGoal = '';
  let generatedHabits = [];

  /* ── CHAR COUNT ── */
  goalInput.addEventListener('input', () => {
    charCount.textContent = `${goalInput.value.length} / 400`;
  });

  /* ── TIMELINE BUTTONS ── */
  timelineBtns.addEventListener('click', e => {
    const btn = e.target.closest('.timeline-btn');
    if (!btn) return;
    document.querySelectorAll('.timeline-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedTimeline = btn.dataset.val;
  });

  /* ── SUBMIT ── */
  submitGoal.addEventListener('click', () => {
    const goal = goalInput.value.trim();
    if (!goal) {
      goalInput.focus();
      goalInput.style.borderColor = 'var(--accent)';
      setTimeout(() => goalInput.style.borderColor = '', 600);
      return;
    }
    currentGoal = goal;
    generateHabits(goal, selectedTimeline);
  });

  /* ── SHOW / HIDE STEPS ── */
  function showStep(step) {
    [stepGoal, stepLoading, stepResults].forEach(s => s.classList.add('hidden'));
    step.classList.remove('hidden');
  }

  /* ── LOADING MESSAGES ── */
  const loadingMessages = [
    'Analysing your goal…',
    'Mapping out a plan…',
    'Selecting the best habits…',
    'Almost ready…',
  ];

  /* ── HABIT GENERATION (rule-based AI simulation) ── */
  function generateHabits(goal, timeline) {
    showStep(stepLoading);

    /* cycle loading messages */
    let msgIdx = 0;
    loadingText.textContent = loadingMessages[0];
    const msgInterval = setInterval(() => {
      msgIdx = (msgIdx + 1) % loadingMessages.length;
      loadingText.textContent = loadingMessages[msgIdx];
    }, 900);

    /* simulate AI thinking time */
    setTimeout(() => {
      clearInterval(msgInterval);
      generatedHabits = matchHabits(goal.toLowerCase(), timeline);
      renderResults(goal, timeline, generatedHabits);
      showStep(stepResults);
    }, 3200);
  }

  /* ── RULE-BASED HABIT MATCHER ── */
  function matchHabits(goal, timeline) {
    const all = habitDatabase();

    /* score each habit by keyword match */
    const scored = all.map(h => {
      let score = 0;
      h.keywords.forEach(kw => {
        if (goal.includes(kw)) score += 2;
      });
      h.broadKeywords.forEach(kw => {
        if (goal.includes(kw)) score += 1;
      });
      return { ...h, score };
    });

    /* sort by score, take top matches, always include at least a fallback set */
    scored.sort((a, b) => b.score - a.score);
    const top = scored.filter(h => h.score > 0).slice(0, 6);
    if (top.length < 4) {
      /* pad with general wellness habits */
      const fallbacks = scored.filter(h => h.score === 0 && h.fallback).slice(0, 4 - top.length);
      return [...top, ...fallbacks];
    }
    return top;
  }

  /* ── RENDER RESULTS ── */
  function renderResults(goal, timeline, habits) {
    resultsGoalPill.textContent = `"${goal.length > 60 ? goal.slice(0, 57) + '…' : goal}"`;
    resultsSub.textContent = `${habits.length} habits tailored for your ${timeline} goal`;

    habitsGrid.innerHTML = '';
    habits.forEach((habit, i) => {
      const card = document.createElement('div');
      card.className = 'habit-suggest-card selected';
      card.style.animationDelay = `${i * 0.07}s`;
      card.innerHTML = `
        <div class="habit-card-top">
          <span class="habit-card-name">${habit.name}</span>
          <button class="habit-card-select" aria-label="Toggle">✓</button>
        </div>
        <p class="habit-card-why">${habit.why}</p>
        <div class="habit-card-meta">
          <span class="habit-card-freq">${habit.freq}</span>
          ${habit.tracking ? `<span class="habit-card-type">${habit.tracking}</span>` : ''}
        </div>
      `;
      /* toggle selection */
      card.querySelector('.habit-card-select').addEventListener('click', e => {
        e.stopPropagation();
        card.classList.toggle('selected');
        updateAddBtn();
      });
      card.addEventListener('click', () => {
        card.classList.toggle('selected');
        updateAddBtn();
      });
      habitsGrid.appendChild(card);
    });
    updateAddBtn();
  }

  function updateAddBtn() {
    const selected = habitsGrid.querySelectorAll('.habit-suggest-card.selected').length;
    addAllBtn.textContent = selected === 0
      ? '✦ Select habits to add'
      : `✦ Add ${selected} habit${selected > 1 ? 's' : ''} to today`;
    addAllBtn.disabled = selected === 0;
    addAllBtn.style.opacity = selected === 0 ? '0.5' : '1';
  }

  /* ── ACTIONS ── */
  addAllBtn.addEventListener('click', () => {
    const selected = habitsGrid.querySelectorAll('.habit-suggest-card.selected');
    /* store in localStorage so home page can pick them up later */
    const toAdd = [];
    selected.forEach(card => {
      toAdd.push(card.querySelector('.habit-card-name').textContent);
    });
    const existing = JSON.parse(localStorage.getItem('ecosvg-pending-habits') || '[]');
    localStorage.setItem('ecosvg-pending-habits', JSON.stringify([...existing, ...toAdd]));

    /* visual feedback */
    addAllBtn.textContent = '✓ Added to your habits!';
    addAllBtn.style.background = 'var(--accent2)';
    setTimeout(() => {
      addAllBtn.textContent = `✦ Add ${selected.length} habit${selected.length > 1 ? 's' : ''} to today`;
      addAllBtn.style.background = '';
    }, 2000);
  });

  regenerateBtn.addEventListener('click', () => {
    generateHabits(currentGoal, selectedTimeline);
  });

  newGoalBtn.addEventListener('click', () => {
    goalInput.value = '';
    charCount.textContent = '0 / 400';
    showStep(stepGoal);
  });

  /* ══════════════════════════════
     HABIT DATABASE
     ══════════════════════════════ */
  function habitDatabase() {
    return [
      /* FITNESS */
      {
        name: 'Morning run',
        why: 'Builds cardiovascular endurance progressively. Start with 10 mins and add 5 mins each week.',
        freq: 'Daily',
        tracking: '📍 GPS auto-tracked',
        fallback: false,
        keywords: ['run', 'running', '5k', '10k', 'marathon', 'cardio', 'fit', 'fitness', 'jog'],
        broadKeywords: ['weight', 'health', 'active', 'stamina'],
      },
      {
        name: 'Push-ups',
        why: 'Builds upper body strength with zero equipment. 3 sets of 10 every morning compounds fast.',
        freq: 'Daily',
        tracking: '📷 Camera AI',
        fallback: false,
        keywords: ['push-up', 'pushup', 'muscle', 'strength', 'upper body', 'arms', 'chest'],
        broadKeywords: ['fit', 'fitness', 'gym', 'workout'],
      },
      {
        name: 'Evening walk (30 min)',
        why: 'Low-impact movement that aids recovery, reduces stress, and keeps daily step count high.',
        freq: 'Daily',
        tracking: '📍 GPS auto-tracked',
        fallback: true,
        keywords: ['walk', 'steps', 'active', 'weight', 'lose'],
        broadKeywords: ['fit', 'health', 'cardio'],
      },
      {
        name: 'Drink 2L water',
        why: 'Hydration is foundational to every goal — energy, recovery, skin, and focus all depend on it.',
        freq: 'Daily',
        tracking: null,
        fallback: true,
        keywords: ['water', 'hydrat', 'health', 'skin', 'energy'],
        broadKeywords: ['fit', 'wellness', 'lose', 'weight'],
      },
      {
        name: 'Strength training',
        why: 'Resistance training 3× a week accelerates fat loss and builds the physique you want.',
        freq: '3× a week',
        tracking: null,
        fallback: false,
        keywords: ['gym', 'lift', 'strength', 'muscle', 'bulk', 'tone', 'weight training'],
        broadKeywords: ['fit', 'fitness', 'body'],
      },
      {
        name: 'Track calories',
        why: 'Awareness of intake is the single most effective tool for weight management.',
        freq: 'Daily',
        tracking: null,
        fallback: false,
        keywords: ['weight', 'lose', 'diet', 'calorie', 'fat', 'slim', 'kg', 'pound'],
        broadKeywords: ['health', 'fit', 'body'],
      },
      /* READING / LEARNING */
      {
        name: 'Read 20 pages',
        why: 'At 20 pages a day you finish roughly 18 books a year. Small daily input, massive annual output.',
        freq: 'Daily',
        tracking: '🎙 Mic detected',
        fallback: false,
        keywords: ['read', 'book', 'reading', 'pages', 'library', 'learn', 'knowledge'],
        broadKeywords: ['habit', 'improve', 'study'],
      },
      {
        name: 'Study session (45 min)',
        why: 'Focused deep-work sessions without distraction are where real learning happens.',
        freq: 'Daily',
        tracking: null,
        fallback: false,
        keywords: ['study', 'learn', 'exam', 'course', 'skill', 'language', 'coding', 'code', 'programming'],
        broadKeywords: ['improve', 'career', 'job'],
      },
      {
        name: 'Practice flashcards (15 min)',
        why: 'Spaced repetition is the most efficient way to memorise anything — languages, facts, formulas.',
        freq: 'Daily',
        tracking: null,
        fallback: false,
        keywords: ['language', 'memorise', 'memorize', 'vocab', 'flashcard', 'exam', 'test'],
        broadKeywords: ['learn', 'study', 'improve'],
      },
      /* MENTAL HEALTH */
      {
        name: 'Meditate (10 min)',
        why: 'Even 10 minutes of daily meditation measurably reduces anxiety and sharpens focus.',
        freq: 'Daily',
        tracking: '🎙 Mic detected',
        fallback: true,
        keywords: ['stress', 'anxiet', 'calm', 'meditat', 'mindful', 'mental', 'peace', 'focus'],
        broadKeywords: ['health', 'wellness', 'sleep', 'happy'],
      },
      {
        name: 'Journaling (5 min)',
        why: 'Writing down thoughts clears mental noise and builds self-awareness over time.',
        freq: 'Daily',
        tracking: null,
        fallback: false,
        keywords: ['journal', 'write', 'reflect', 'mental', 'anxiet', 'stress', 'emotion', 'mood'],
        broadKeywords: ['happy', 'wellness', 'mindful'],
      },
      {
        name: 'No phone first hour',
        why: 'Protecting your morning from scrolling sets a focused, intentional tone for the whole day.',
        freq: 'Daily',
        tracking: null,
        fallback: false,
        keywords: ['phone', 'social media', 'scroll', 'screen', 'distract', 'focus', 'productive'],
        broadKeywords: ['mental', 'calm', 'productivity'],
      },
      /* SLEEP */
      {
        name: 'Sleep by 11 PM',
        why: 'Consistent sleep timing regulates your circadian rhythm — the foundation of energy and recovery.',
        freq: 'Daily',
        tracking: null,
        fallback: false,
        keywords: ['sleep', 'rest', 'tired', 'energy', 'wake', 'morning'],
        broadKeywords: ['health', 'wellness', 'recover'],
      },
      /* CAREER / PRODUCTIVITY */
      {
        name: 'Deep work block (2h)',
        why: 'Scheduled, distraction-free work time is where meaningful progress on big goals happens.',
        freq: 'Weekdays',
        tracking: null,
        fallback: false,
        keywords: ['work', 'career', 'job', 'productiv', 'project', 'business', 'start', 'launch'],
        broadKeywords: ['goal', 'success', 'achieve'],
      },
      {
        name: 'Daily planning (10 min)',
        why: 'Spending 10 minutes planning your day returns hours of focused output.',
        freq: 'Daily',
        tracking: null,
        fallback: true,
        keywords: ['plan', 'organis', 'organiz', 'productiv', 'todo', 'task', 'goal'],
        broadKeywords: ['work', 'success', 'achieve', 'career'],
      },
      /* FINANCE */
      {
        name: 'Log daily expenses',
        why: 'Tracking spending is the first step to saving. What gets measured gets managed.',
        freq: 'Daily',
        tracking: null,
        fallback: false,
        keywords: ['money', 'save', 'saving', 'finance', 'budget', 'spend', 'debt', 'invest'],
        broadKeywords: ['financial', 'rich', 'wealth'],
      },
      {
        name: 'No impulse purchases',
        why: 'A 24-hour waiting rule on non-essential purchases cuts unnecessary spending dramatically.',
        freq: 'Daily',
        tracking: null,
        fallback: false,
        keywords: ['save', 'saving', 'spend', 'budget', 'money', 'shopping', 'impulse'],
        broadKeywords: ['finance', 'debt'],
      },
    ];
  }

});