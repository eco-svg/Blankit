document.addEventListener('DOMContentLoaded', () => {
    const chatWindow = document.getElementById('chatWindow');
    const aiInput = document.getElementById('aiInput');
    const sendAiBtn = document.getElementById('sendAiBtn');

    function appendMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${sender === 'user' ? 'msg-user' : 'msg-ai'}`;
        msgDiv.textContent = text;
        chatWindow.appendChild(msgDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight; // Auto-scroll to bottom
    }

    function askAI() {
        const prompt = aiInput.value.trim();
        if (!prompt) return;

        // 1. Show user message
        appendMessage(prompt, 'user');
        aiInput.value = '';
        
        // Disable input while thinking
        aiInput.disabled = true;
        sendAiBtn.style.opacity = '0.5';

        // 2. Fetch from our Python backend
        fetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: prompt })
        })
        .then(res => res.json())
        .then(data => {
            if (data.reply) {
                appendMessage(data.reply, 'ai');
            } else {
                appendMessage("Error: Could not reach the mainframe.", 'ai');
            }
        })
        .catch(err => {
            appendMessage("Connection offline.", 'ai');
        })
        .finally(() => {
            // Re-enable input
            aiInput.disabled = false;
            sendAiBtn.style.opacity = '1';
            aiInput.focus();
        });
    }

    sendAiBtn.addEventListener('click', askAI);
    aiInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') askAI();
    });
});