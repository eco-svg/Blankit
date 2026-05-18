/**
 * AI Coach
 * Handles motivational quotes and chat interactions
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

    responses: {
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

    /**
     * Initialize coach module
     */
    init(habitData) {
        this.data = habitData;
        this.cacheElements();
        this.attachEvents();
        this.generateQuote();
        this.addWelcomeMessage();
    },

    /**
     * Cache DOM elements
     */
    cacheElements() {
        this.elements = {
            quoteBox: document.getElementById('quoteBox'),
            newQuoteBtn: document.getElementById('newQuoteBtn'),
            chatHistory: document.getElementById('chatHistory'),
            chatInput: document.getElementById('chatInput'),
            sendBtn: document.getElementById('sendMessageBtn'),
            moodSelect: document.getElementById('moodSelect'),
            notesArea: document.getElementById('notesArea'),
            saveNotesBtn: document.getElementById('saveNotesBtn')
        };
    },

    /**
     * Attach event listeners
     */
    attachEvents() {
        this.elements.newQuoteBtn.addEventListener('click', () => {
            this.generateQuote();
        });

        this.elements.sendBtn.addEventListener('click', () => {
            this.sendMessage();
        });

        this.elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        this.elements.saveNotesBtn.addEventListener('click', () => {
            this.saveNotes();
        });
    },

    /**
     * Generate random quote
     */
    generateQuote() {
        const randomQuote = this.quotes[Math.floor(Math.random() * this.quotes.length)];
        this.elements.quoteBox.style.opacity = '0';
        
        setTimeout(() => {
            this.elements.quoteBox.textContent = randomQuote;
            this.elements.quoteBox.style.opacity = '1';
        }, 200);
    },

    /**
     * Add welcome message
     */
    addWelcomeMessage() {
        this.addMessage('Coach', 'Ready to crush today? What\'s on your mind?');
    },

    /**
     * Send chat message
     */
    sendMessage() {
        const message = this.elements.chatInput.value.trim();
        
        if (message === '') return;

        this.addMessage('You', message);
        this.elements.chatInput.value = '';

        // Generate response based on mood
        setTimeout(() => {
            const mood = this.elements.moodSelect.value;
            const moodResponses = this.responses[mood];
            const response = moodResponses[Math.floor(Math.random() * moodResponses.length)];
            this.addMessage('Coach', response);
        }, 500);
    },

    /**
     * Add message to chat
     * @param {string} sender - Sender name (You/Coach)
     * @param {string} message - Message text
     */
    addMessage(sender, message) {
        const div = document.createElement('div');
        div.className = 'chat-message';

        const senderClass = sender === 'You' ? 'chat-user' : 'chat-coach';
        const span = document.createElement('span');
        span.className = senderClass;
        span.textContent = `${sender}:`;

        div.appendChild(span);
        div.appendChild(document.createTextNode(` ${message}`));

        this.elements.chatHistory.appendChild(div);
        this.elements.chatHistory.scrollTop = this.elements.chatHistory.scrollHeight;
    },

    /**
     * Save notes
     */
    saveNotes() {
        const notes = this.elements.notesArea.value;
        
        if (notes.trim() === '') {
            alert('No notes to save!');
            return;
        }

        this.data.notes = notes;
        DataManager.saveData(this.data);

        if (typeof History !== 'undefined') {
            History.addEntry('Saved daily notes');
        }

        alert('✅ Notes saved successfully!');
        this.addMessage('Coach', 'Notes locked in. Good to see you documenting the journey!');
    },

    /**
     * Load notes
     */
    loadNotes() {
        this.elements.notesArea.value = this.data.notes || '';
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Coach;
}