document.addEventListener('DOMContentLoaded', () => {

    const chatWindow  = document.getElementById('chatWindow');
    const aiInput     = document.getElementById('aiInput');
    const sendBtn     = document.getElementById('sendAiBtn');

    // How many prompts the user has used this session
    // This is the "10-prompt cache" mentioned in the UI
    let promptCount = 0;
    const MAX_PROMPTS = 10;

    // ── Add a message bubble to the chat window ──
    // role = 'user' or 'ai'
    function addMessage(text, role) {
        const msg = document.createElement('div');
        msg.className = `chat-message msg-${role}`;

        // marked.parse() converts markdown text → HTML
        // e.g. **bold** becomes <strong>bold</strong>
        // This is why marked.min.js is loaded in home.html
        msg.innerHTML = (role === 'ai' && typeof marked !== 'undefined')
            ? marked.parse(text)
            : text;

        chatWindow.appendChild(msg);

        // Auto-scroll to the latest message
        // scrollTop = scrollHeight pushes scroll position to the very bottom
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    // ── Show a typing indicator while waiting for response ──
    function showTyping() {
        const el = document.createElement('div');
        el.className = 'chat-message msg-ai';
        el.id = 'typingIndicator';
        el.innerHTML = '<span style="opacity:0.5; font-style:italic;">Thinking...</span>';
        chatWindow.appendChild(el);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function removeTyping() {
        const el = document.getElementById('typingIndicator');
        if (el) el.remove();
    }

    // ── Main send function ──
    async function sendMessage() {
        const query = aiInput.value.trim();
        if (!query) return;

        // Enforce prompt limit
        if (promptCount >= MAX_PROMPTS) {
            addMessage('10-prompt cache limit reached for this session. Refresh to reset.', 'ai');
            return;
        }

        aiInput.value = '';
        promptCount++;
        addMessage(query, 'user');
        showTyping();

        try {
            // POST the query to our Flask backend
            // Flask then calls the AI API and returns the response
            // Keeping AI calls server-side means the API key is never exposed to the browser
            const res = await fetch('/api/ask', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ query: query })
            });

            const data = await res.json();
            removeTyping();

            if (data.answer) {
                addMessage(data.answer, 'ai');
            } else if (data.error) {
                addMessage(`Error: ${data.error}`, 'ai');
            }

        } catch (err) {
            removeTyping();
            console.error('Ask error:', err);
            addMessage('Connection failed. Check your network.', 'ai');
        }
    }

    // ── Event listeners ──
    sendBtn.addEventListener('click', sendMessage);

    // Enter key sends, Shift+Enter adds a new line
    aiInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

});