/**
 * gaps.js — Home-tab UI glue. The Dream now lives in the header (headerbar.js
 * owns its display + entry), so this file just drives the wisdom/fact bar.
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- THE WISDOM & FACT ENGINE ---
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