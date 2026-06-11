/**
 * AI Coach
 * Uses Groq API for real AI responses.
 * Falls back to hardcoded replies if API is unavailable.
 */

const Coach = {
    elements: {},
    data: null,

    quotes: [
        "Discipline is choosing between what you want now and what you want most.",
        "The pain of discipline is far less than the pain of regret.",
        "You don't have to be great to start, but you have to start to be great.",
        "Success is the sum of small efforts repeated day in and day out.",
        "Your future self will thank you for the work you do today.",
        "Consistency beats perfection every single time.",
        "Stop waiting for motivation. Start building discipline.",
        "The best time to start was yesterday. The next best time is now."
    ],

    fallbackResponses: {
        'Energized': [
            "Perfect! Let's crush this. Which task are we tackling first?",
            "That energy is fire! Channel it into your hardest task right now.",
            "You're in beast mode. Don't waste this momentum - execute!"
        ],
        'Stressed': [
            "Take a breath. Let's break it down into small steps. What's one thing you can do right now?",
            "Stress means you care. That's good. Now let's turn that into focused action.",
            "Feeling overwhelmed? Start with the easiest task to build momentum."
        ],
        'Lazy': [
            "Motivation is overrated. Discipline is what separates winners from wishers.",
            "Your future self is watching. Make them proud. Get up and start.",
            "Being lazy today = being stressed tomorrow. Choose wisely."
        ],
        'Normal': [
            "Solid energy. Let's put it to work. What's the priority?",
            "Consistency is key. Another day, another step forward.",
            "Ready to add another brick to your empire?"
        ]
    },

    init(habitData) {
        this.data = habitData;
        this.cacheElements();
        this.attachEvents();
        this.generateQuote();
        this.addWelcomeMessage();
    },

    cacheElements() {
        this.elements = {
            quoteBox:     document.getElementById('quoteBox'),
            newQuoteBtn:  document.getElementById('newQuoteBtn'),
            chatHistory:  document.getElementById('chatHistory'),
            chatInput:    document.getElementById('chatInput'),
            sendBtn:      document.getElementById('sendMessageBtn'),
            moodSelect:   document.getElementById('moodSelect'),
            notesArea:    document.getElementById('notesArea'),
            saveNotesBtn: document.getElementById('saveNotesBtn')
        };
    },

    attachEvents() {
        this.elements.newQuoteBtn.addEventListener('click', () => {
            this.generateQuote();
        });
        this.elements.sendBtn.addEventListener('click', () => {
            this.sendMessage();
        });
        this.elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        this.elements.saveNotesBtn.addEventListener('click', () => {
            this.saveNotes();
        });
    },

    generateQuote() {
        const randomQuote = this.quotes[Math.floor(Math.random() * this.quotes.length)];
        this.elements.quoteBox.style.opacity = '0';
        setTimeout(() => {
            this.elements.quoteBox.textContent = randomQuote;
            this.elements.quoteBox.style.opacity = '1';
        }, 200);
    },

    addWelcomeMessage() {
        this.addMessage('Coach', "Ready to crush today? What's on your mind?");
    },

    /**
     * Send message — calls Groq API, falls back to hardcoded
     */
    sendMessage() {
        const message = this.elements.chatInput.value.trim();
        if (message === '') return;

        this.addMessage('You', message);
        this.elements.chatInput.value = '';
        this.addTypingIndicator();

        const mood = this.elements.moodSelect?.value || 'Normal';

        fetch('/d/api/coach', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, mood })
        })
        .then(res => {
            if (!res.ok) throw new Error('API error');
            return res.json();
        })
        .then(data => {
            this.removeTypingIndicator();
            this.addMessage('Coach', data.reply || this.getFallbackReply(mood));
        })
        .catch(() => {
            this.removeTypingIndicator();
            this.addMessage('Coach', this.getFallbackReply(mood));
        });
    },

    getFallbackReply(mood) {
        const responses = this.fallbackResponses[mood] || this.fallbackResponses['Normal'];
        return responses[Math.floor(Math.random() * responses.length)];
    },

    addTypingIndicator() {
        const div      = document.createElement('div');
        div.className  = 'chat-message';
        div.id         = 'typingIndicator';

        const label       = document.createElement('span');
        label.className   = 'chat-coach';
        label.textContent = 'Coach:';

        const dots        = document.createElement('span');
        dots.textContent  = ' ●●●';
        dots.style.cssText = 'color:var(--text-dim);animation:blink 1s infinite;';

        div.appendChild(label);
        div.appendChild(dots);
        this.elements.chatHistory.appendChild(div);
        this.elements.chatHistory.scrollTop =
            this.elements.chatHistory.scrollHeight;

        if (!document.getElementById('blinkStyle')) {
            const style = document.createElement('style');
            style.id = 'blinkStyle';
            style.textContent = '@keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}';
            document.head.appendChild(style);
        }
    },

    removeTypingIndicator() {
        const el = document.getElementById('typingIndicator');
        if (el) el.remove();
    },

    addMessage(sender, message) {
        const div         = document.createElement('div');
        div.className     = 'chat-message';

        const span        = document.createElement('span');
        span.className    = sender === 'You' ? 'chat-user' : 'chat-coach';
        span.textContent  = `${sender}:`;

        div.appendChild(span);
        div.appendChild(document.createTextNode(` ${message}`));
        this.elements.chatHistory.appendChild(div);
        this.elements.chatHistory.scrollTop =
            this.elements.chatHistory.scrollHeight;
    },

    saveNotes() {
        const notes = this.elements.notesArea.value;
        if (notes.trim() === '') { alert('No notes to save!'); return; }
        this.data.notes = notes;
        DataManager.saveData(this.data);
        if (typeof History !== 'undefined') History.addEntry('Saved daily notes');
        alert('✅ Notes saved successfully!');
        this.addMessage('Coach', 'Notes locked in. Good to see you documenting the journey!');
    },

    loadNotes() {
        this.elements.notesArea.value = this.data.notes || '';
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Coach;
}