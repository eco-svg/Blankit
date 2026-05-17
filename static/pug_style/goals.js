document.addEventListener('DOMContentLoaded', () => {

    // ── Main screen elements (now unused for goals display — kept for compatibility) ─
    const inputGoal   = document.getElementById('newGoalInput');
    const btnAddGoal  = document.getElementById('addGoalBtn');

    // ── Sidebar elements ─────────────────────────────────────────────────────────
    const rActiveList   = document.getElementById('rActiveGoalsList');
    const rFinishedList = document.getElementById('rFinishedList');
    const rCancelList   = document.getElementById('rCancelledList');
    const rInput        = document.getElementById('rNewGoalInput');
    const rAddBtn       = document.getElementById('rAddGoalBtn');

    // ── Achieve modal ─────────────────────────────────────────────────────────────
    const achieveModal      = document.getElementById('achieveModal');
    const btnCancelAchieve  = document.getElementById('cancelAchieveBtn');
    const btnConfirmAchieve = document.getElementById('confirmAchieveBtn');
    let pendingAchieveId    = null;

    if (btnCancelAchieve && btnConfirmAchieve && achieveModal) {
        btnCancelAchieve.addEventListener('click', () => {
            achieveModal.classList.add('hidden');
            pendingAchieveId = null;
        });
        btnConfirmAchieve.addEventListener('click', () => {
            if (pendingAchieveId) {
                fetch(`/pug/api/goals/${pendingAchieveId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_finished: true })
                }).then(() => {
                    achieveModal.classList.add('hidden');
                    pendingAchieveId = null;
                    loadGoals();
                });
            }
        });
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────
    function makeRGoalItem(goal) {
        const el = document.createElement('div');
        el.className = 'r-goal-item';
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
            fetch(`/pug/api/goals/${goal.id}`, { method: 'DELETE' }).then(loadGoals);
        });
        return el;
    }

    // ── Load & render all goals ───────────────────────────────────────────────────
    function loadGoals() {
        fetch('/pug/api/goals')
            .then(r => r.json())
            .then(goals => {
                if (rActiveList)   rActiveList.innerHTML   = '';
                if (rFinishedList) rFinishedList.innerHTML = '';

                let activeCount = 0, finishedCount = 0;

                goals.forEach(goal => {
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

                if (rActiveList && activeCount === 0) {
                    rActiveList.innerHTML = '<div style="font-size:0.68rem;color:var(--text-dim);opacity:0.5;padding:4px 6px;">Nothing active.</div>';
                }
                if (rFinishedList && finishedCount === 0) {
                    rFinishedList.innerHTML = '<div style="font-size:0.68rem;color:var(--text-dim);opacity:0.35;padding:4px 6px;">None yet.</div>';
                }

                window.dispatchEvent(new Event('goalUpdated'));
            });

        // Load cancelled separately
        fetch('/pug/api/goals/cancelled')
            .then(r => r.json())
            .then(goals => {
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
            })
            .catch(() => {
                if (rCancelList) rCancelList.innerHTML = '';
            });
    }

    // ── Add goal ──────────────────────────────────────────────────────────────────
    function addGoal(title) {
        if (!title) return;
        fetch('/pug/api/goals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        }).then(loadGoals);
    }

    // Sidebar input
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

    // Main screen input (kept for backwards compat, card removed but input may still exist)
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
