document.addEventListener('DOMContentLoaded', () => {
    const activeGoalsList = document.getElementById('activeGoalsList');
    const finishedGoalsList = document.getElementById('finishedGoalsList');
    const inputGoal = document.getElementById('newGoalInput');
    const btnAddGoal = document.getElementById('addGoalBtn');

    // --- NEW: Custom Modal Logic for Achieving Goals ---
    const achieveModal = document.getElementById('achieveModal');
    const btnCancelAchieve = document.getElementById('cancelAchieveBtn');
    const btnConfirmAchieve = document.getElementById('confirmAchieveBtn');
    let pendingAchieveId = null;

    if (btnCancelAchieve && btnConfirmAchieve && achieveModal) {
        btnCancelAchieve.addEventListener('click', () => {
            achieveModal.classList.add('hidden');
            pendingAchieveId = null;
        });

        btnConfirmAchieve.addEventListener('click', () => {
            if (pendingAchieveId) {
                fetch(`/api/goals/${pendingAchieveId}`, {
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

    function loadGoals() {
        fetch('/api/goals')
            .then(res => res.json())
            .then(goals => {
                activeGoalsList.innerHTML = '';
                finishedGoalsList.innerHTML = '';

                let activeCount = 0;
                let finishedCount = 0;

                goals.forEach(goal => {
                    const el = document.createElement('div');
                    el.className = goal.is_finished ? 'goal-item finished-item' : 'goal-item';
                    
                    if (!goal.is_finished) {
                        activeCount++;
                        el.innerHTML = `
                            <span class="goal-text">${goal.title}</span>
                            <div class="goal-actions">
                                <button class="btn-goal-action action-achieve" title="Mark Achieved" data-id="${goal.id}">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                </button>
                                <button class="btn-goal-action action-remove" title="Remove Goal" data-id="${goal.id}">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>
                        `;
                        activeGoalsList.appendChild(el);
                    } else {
                        finishedCount++;
                        el.innerHTML = `<span class="goal-text">${goal.title}</span>`;
                        finishedGoalsList.appendChild(el);
                    }
                });

                // --- THE EMPTY STATES ---
                if (activeCount === 0) {
                    activeGoalsList.innerHTML = '<p style="text-align:center; color:var(--text-dim); margin-top:20px; font-style: italic;">No active goals. Set your sights on something!</p>';
                }
                if (finishedCount === 0) {
                    finishedGoalsList.innerHTML = '<p style="text-align:center; color:var(--text-dim); margin-top:20px; font-style: italic;">Nothing finished yet. Get to work!</p>';
                }

                attachActionListeners();

                // --- THE CHART TRIGGER ---
                // Tell the chart to update ONLY after the new goals have been loaded!
                window.dispatchEvent(new Event('goalUpdated'));
            });
    }

    function addGoal() {
        const title = inputGoal.value.trim();
        if (!title) return;

        fetch('/api/goals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title })
        }).then(() => {
            inputGoal.value = '';
            loadGoals(); 
        });
    }

    btnAddGoal.addEventListener('click', addGoal);
    inputGoal.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addGoal();
    });

    function attachActionListeners() {
        document.querySelectorAll('.action-achieve').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Trigger the custom modal instead of standard confirm
                pendingAchieveId = e.currentTarget.getAttribute('data-id');
                if (achieveModal) {
                    achieveModal.classList.remove('hidden');
                } else {
                     // Fallback if modal HTML is missing
                    if (confirm("Move this to Finished?")) {
                        fetch(`/api/goals/${pendingAchieveId}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ is_finished: true })
                        }).then(loadGoals);
                    }
                }
            });
        });

        document.querySelectorAll('.action-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                fetch(`/api/goals/${id}`, { method: 'DELETE' }).then(loadGoals);
            });
        });
    }

    // Initial load
    loadGoals();
});