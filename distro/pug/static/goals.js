/**
 * goals.js — Goals widget — create / update / finish / delete goals.
 */

document.addEventListener('DOMContentLoaded', () => {

    const inputGoal   = document.getElementById('newGoalInput');
    const btnAddGoal  = document.getElementById('addGoalBtn');
    const rActiveList   = document.getElementById('rActiveGoalsList');
    const rFinishedList = document.getElementById('rFinishedList');
    const rCancelList   = document.getElementById('rCancelledList');
    const rInput        = document.getElementById('rNewGoalInput');
    const rAddBtn       = document.getElementById('rAddGoalBtn');
    const achieveModal      = document.getElementById('achieveModal');
    const btnCancelAchieve  = document.getElementById('cancelAchieveBtn');
    const btnConfirmAchieve = document.getElementById('confirmAchieveBtn');

    let pendingAchieveId = null;
    let goalsCache       = []; // active + finished
    let cancelledCache   = []; // cancelled (loaded once, not mutated locally)

    // ── Achieve modal ─────────────────────────────────────────────────────────────
    if (btnCancelAchieve && btnConfirmAchieve && achieveModal) {
        btnCancelAchieve.addEventListener('click', () => {
            achieveModal.classList.add('hidden');
            pendingAchieveId = null;
        });
        btnConfirmAchieve.addEventListener('click', () => {
            if (!pendingAchieveId) return;
            const id = pendingAchieveId;
            pendingAchieveId = null;
            achieveModal.classList.add('hidden');
            const g = goalsCache.find(x => x.id === id);
            if (g) g.is_finished = true;
            renderGoals();
            fetch(`/pug/api/goals/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_finished: true })
            }).catch(() => {
                const g = goalsCache.find(x => x.id === id);
                if (g) g.is_finished = false;
                renderGoals();
            });
        });
    }

    // ── Render ────────────────────────────────────────────────────────────────────
    function makeRGoalItem(goal) {
        const el = document.createElement('div');
        el.className = 'r-goal-item';
        if (goal.id == null) {
            el.innerHTML = `<span class="r-goal-text" title="${goal.title}">${goal.title}</span>
                <span style="font-size:0.62rem;opacity:0.35;font-family:var(--font-mono)">saving…</span>`;
            return el;
        }
        el.innerHTML = `
            <span class="r-goal-text" title="${goal.title}">${goal.title}</span>
            <div class="r-goal-actions">
                <button class="r-goal-btn btn-finish" data-id="${goal.id}" title="Mark done">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </button>
                <button class="r-goal-btn btn-cancel" data-id="${goal.id}" title="Cancel">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>`;
        el.querySelector('.btn-finish').addEventListener('click', () => {
            pendingAchieveId = goal.id;
            achieveModal?.classList.remove('hidden');
        });
        el.querySelector('.btn-cancel').addEventListener('click', () => {
            goalsCache = goalsCache.filter(x => x.id !== goal.id);
            renderGoals();
            fetch(`/pug/api/goals/${goal.id}`, { method: 'DELETE' })
                .catch(() => loadGoals());
        });
        return el;
    }

    function renderGoals() {
        if (rActiveList)   rActiveList.innerHTML   = '';
        if (rFinishedList) rFinishedList.innerHTML = '';

        let activeCount = 0, finishedCount = 0;
        goalsCache.forEach(goal => {
            if (goal.is_finished) {
                finishedCount++;
                if (rFinishedList) {
                    const el = document.createElement('div');
                    el.className = 'r-done-item finished';
                    el.title = goal.title;
                    el.textContent = goal.title;
                    rFinishedList.appendChild(el);
                }
            } else {
                activeCount++;
                if (rActiveList) rActiveList.appendChild(makeRGoalItem(goal));
            }
        });

        if (rActiveList && activeCount === 0)
            rActiveList.innerHTML = '<div style="font-size:0.68rem;color:var(--text-dim);opacity:0.5;padding:4px 6px;">Nothing active.</div>';
        if (rFinishedList && finishedCount === 0)
            rFinishedList.innerHTML = '<div style="font-size:0.68rem;color:var(--text-dim);opacity:0.35;padding:4px 6px;">None yet.</div>';

        window.dispatchEvent(new Event('goalUpdated'));
    }

    function renderCancelled(goals) {
        if (!rCancelList) return;
        rCancelList.innerHTML = '';
        if (!goals.length) {
            rCancelList.innerHTML = '<div style="font-size:0.68rem;color:var(--text-dim);opacity:0.35;padding:4px 6px;">None.</div>';
            return;
        }
        goals.forEach(goal => {
            const el = document.createElement('div');
            el.className = 'r-done-item cancelled';
            el.title = goal.title;
            el.textContent = goal.title;
            rCancelList.appendChild(el);
        });
    }

    // ── Load (initial only) ───────────────────────────────────────────────────────
    function loadGoals() {
        fetch('/pug/api/goals')
            .then(r => r.json())
            .then(goals => { goalsCache = goals; renderGoals(); });

        fetch('/pug/api/goals/cancelled')
            .then(r => r.json())
            .then(goals => { cancelledCache = goals; renderCancelled(goals); })
            .catch(() => { if (rCancelList) rCancelList.innerHTML = ''; });
    }

    // ── Add (optimistic) ─────────────────────────────────────────────────────────
    function addGoal(title) {
        if (!title) return;
        const temp = { id: null, title, is_finished: false };
        goalsCache.push(temp);
        renderGoals();
        fetch('/pug/api/goals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        })
        .then(r => r.json())
        .then(data => {
            if (data.status === 'success') {
                temp.id = data.id;
                renderGoals();
            } else {
                goalsCache = goalsCache.filter(x => x !== temp);
                renderGoals();
            }
        })
        .catch(() => { goalsCache = goalsCache.filter(x => x !== temp); renderGoals(); });
    }

    if (rAddBtn && rInput) {
        rAddBtn.addEventListener('click', () => {
            const t = rInput.value.trim();
            if (t) { rInput.value = ''; addGoal(t); }
        });
        rInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                const t = rInput.value.trim();
                if (t) { rInput.value = ''; addGoal(t); }
            }
        });
    }

    if (btnAddGoal && inputGoal) {
        btnAddGoal.addEventListener('click', () => {
            const t = inputGoal.value.trim();
            if (t) { inputGoal.value = ''; addGoal(t); }
        });
        inputGoal.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                const t = inputGoal.value.trim();
                if (t) { inputGoal.value = ''; addGoal(t); }
            }
        });
    }

    loadGoals();
});
