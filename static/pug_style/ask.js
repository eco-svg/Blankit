document.addEventListener('DOMContentLoaded', () => {
    const chatWindow = document.getElementById('chatWindow');
    const aiInput = document.getElementById('aiInput');
    const sendAiBtn = document.getElementById('sendAiBtn');

    // Local session memory (Not in DB)
    let knowledgeMemory = [
        { role: "system", content: "You are the Knowledge Engine. Provide objective, high-detail facts. Keep it cold and data-driven." }
    ];

    function appendMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${sender === 'user' ? 'msg-user' : 'msg-ai'}`;
        msgDiv.textContent = text;
        chatWindow.appendChild(msgDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function askKnowledge() {
        const prompt = aiInput.value.trim();
        if (!prompt) return;

        appendMessage(prompt, 'user');
        knowledgeMemory.push({ role: "user", content: prompt });

        // Maintain 10-prompt sliding window (Total 11 items including system prompt)
        if (knowledgeMemory.length > 11) {
            knowledgeMemory.splice(1, 1); 
        }

        aiInput.value = '';
        aiInput.disabled = true;

        fetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: knowledgeMemory })
        })
        .then(res => res.json())
        .then(data => {
            if (data.reply) {
                appendMessage(data.reply, 'ai');
                knowledgeMemory.push({ role: "assistant", content: data.reply });
            }
        })
        .catch(() => appendMessage("Knowledge stream interrupted.", "ai"))
        .finally(() => {
            aiInput.disabled = false;
            aiInput.focus();
        });
    }

    sendAiBtn.addEventListener('click', askKnowledge);
    aiInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') askKnowledge(); });
});