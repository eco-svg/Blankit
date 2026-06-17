/**
 * gaps.js — Home-tab modals & UI glue (e.g. the Dream entry confirm modal).
 */

document.addEventListener('DOMContentLoaded', () => {
    
    // --- NEW: Custom Modal Logic for the Dream ---
    const dreamModal = document.getElementById('dreamModal');
    const btnCancelDream = document.getElementById('cancelDreamBtn');
    const btnConfirmDream = document.getElementById('confirmDreamBtn');
    let pendingDreamText = "";

    if (btnCancelDream && btnConfirmDream && dreamModal) {
        btnCancelDream.addEventListener('click', () => {
            dreamModal.classList.add('hidden');
            pendingDreamText = "";
        });

        btnConfirmDream.addEventListener('click', () => {
            if (pendingDreamText) {
                lockInDream(pendingDreamText);
                dreamModal.classList.add('hidden');
            }
        });
    }

    // --- 1. THE ONE-SHOT DREAM LOGIC ---
    // Lives in its own standalone bar atop the content now — the header slot
    // (#dreamContainer) was handed to headerbar.js (Deadline / Wisdom).
    const dreamContainer = document.getElementById('dreamStandalone');

    function renderDreamInput() {
        if (!dreamContainer) return;
        dreamContainer.innerHTML = `
            <input type="text" id="dreamInput" class="dream-input" 
                   placeholder="Define your ultimate long-term dream. Choose carefully..." 
                   autocomplete="off" spellcheck="false">
        `;
        
        const input = document.getElementById('dreamInput');
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && input.value.trim() !== '') {
                pendingDreamText = input.value.trim();
                if (dreamModal) {
                    dreamModal.classList.remove('hidden');
                } else {
                    lockInDream(pendingDreamText); 
                }
            }
        });
    }

    function renderLockedDream(text) {
        if (!dreamContainer) return;
        dreamContainer.innerHTML = `<span class="dream-text">" ${text} "</span>`;
    }

    function checkDream() {
        fetch('/pug/api/dream')
            .then(res => {
                if (!res.ok) throw new Error("API not ready");
                return res.json();
            })
            .then(data => {
                if (data && data.dream) {
                    renderLockedDream(data.dream);
                } else {
                    renderDreamInput();
                }
            })
            .catch(err => {
                console.error("Dream API error:", err);
                renderDreamInput();
            });
    }

    function lockInDream(dreamText) {
        fetch('/pug/api/dream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: dreamText })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success') {
                renderLockedDream(data.dream);
            }
        })
        .catch(err => alert("Failed to save Dream to database. Check terminal."));
    }

    checkDream();


    // --- 2. THE WISDOM & FACT ENGINE ---
    const quoteElements = document.querySelectorAll('.random-quote');
    
    // An upgraded offline mix of Quotes, Science, and Tech facts
    const offlineMix = [
        "Discipline equals freedom. - Jocko Willink",
        "The obstacle is the way. - Marcus Aurelius",
        "Linux runs on all 500 of the world's top supercomputers.",
        "Honey never spoils. Archaeologists found pots of honey in ancient Egyptian tombs that are over 3,000 years old.",
        "Amateurs sit and wait for inspiration, the rest of us just get up and go to work. - Stephen King",
        "The first computer mouse was invented in 1964 and was made out of wood.",
        "We suffer more often in imagination than in reality. - Seneca",
        "A day on Venus is longer than a year on Venus.",
        "There are more trees on Earth than stars in the Milky Way galaxy."
    ];

    async function fetchWisdom(el) {
        try {
            const res = await fetch('/pug/api/wisdom');
            const data = await res.json();
            if (data.text) { el.textContent = data.text; return; }
            throw new Error('empty');
        } catch (err) {
            const fallback = offlineMix[Math.floor(Math.random() * offlineMix.length)];
            el.textContent = fallback;
        }
    }

    // Unleash the engine on all gap bars simultaneously
    quoteElements.forEach(el => {
        fetchWisdom(el);
    });
});