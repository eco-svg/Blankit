document.addEventListener('DOMContentLoaded', async () => {

    const downloadState = document.getElementById('blinkDownloadState');
    const chatState     = document.getElementById('blinkChatState');
    const chatWindow    = document.getElementById('blinkChatWindow');
    const input         = document.getElementById('blinkInput');
    const sendBtn       = document.getElementById('sendBlinkBtn');

    const OLLAMA        = 'http://localhost:11434';
    const BLINK_MODEL   = 'blinkbot';

    let history       = [];
    let systemPrompt  = '';
    let userCtx       = {};
    let buddyEndpoint = '/pug/api/buddybot';

    // ── Detect Ollama + BlinkBot model ──────────────────────────────────────
    async function detectBlinkBot() {
        try {
            const res  = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) });
            if (!res.ok) return false;
            const data = await res.json();
            return (data.models || []).some(m => m.name.startsWith(BLINK_MODEL));
        } catch {
            return false;
        }
    }

    // ── Fetch system prompt + user context from server ──────────────────────
    async function loadContext() {
        try {
            const res = await fetch('/pug/api/blinkbot-context');
            if (!res.ok) return false;
            const data  = await res.json();
            systemPrompt  = data.system_prompt  || '';
            userCtx       = data.user_context   || {};
            buddyEndpoint = data.buddybot_endpoint || '/pug/api/buddybot';
            return true;
        } catch {
            return false;
        }
    }

    // ── Activate chat panel ─────────────────────────────────────────────────
    function activateChat() {
        downloadState.style.display   = 'none';
        chatState.style.display       = 'flex';
        chatState.style.flexDirection = 'column';
        chatState.style.flex          = '1';
        input.focus();
    }

    // ── Fill install command using current host ─────────────────────────────
    const cmdEl = document.getElementById('blinkInstallCmd');
    if (cmdEl) {
        cmdEl.textContent = `curl -fsSL http://${location.host}/pug/install/blinkbot | bash`;
    }

    // ── Boot sequence ───────────────────────────────────────────────────────
    const [ollamaFound, ctxLoaded] = await Promise.all([detectBlinkBot(), loadContext()]);
    if (ollamaFound && ctxLoaded) {
        activateChat();
    } else {
        // Poll every 5 seconds; auto-activate when BlinkBot comes online
        const waitEl = document.getElementById('blinkWaiting');
        const dotEl  = document.getElementById('blinkWaitDot');
        if (waitEl) waitEl.style.display = 'block';

        const dots   = ['·', '··', '···'];
        let dotIdx   = 0;
        const dotTick = setInterval(() => {
            dotIdx = (dotIdx + 1) % dots.length;
            if (dotEl) dotEl.textContent = dots[dotIdx];
        }, 500);

        const poll = setInterval(async () => {
            const [found, ctx] = await Promise.all([detectBlinkBot(), loadContext()]);
            if (found && ctx) {
                clearInterval(poll);
                clearInterval(dotTick);
                activateChat();
            }
        }, 5000);
    }

    // ── Chat helpers ────────────────────────────────────────────────────────
    function addMessage(text, role, source) {
        const msg     = document.createElement('div');
        msg.className = `chat-message msg-${role === 'assistant' ? 'ai' : 'user'}`;
        const body    = (role === 'assistant' && typeof marked !== 'undefined')
            ? marked.parse(text)
            : text;
        const tag     = (role === 'assistant' && source)
            ? `<span style="font-size:0.6rem;opacity:0.28;display:block;margin-top:4px;font-family:var(--font-mono);">${source}</span>`
            : '';
        msg.innerHTML = body + tag;
        chatWindow.appendChild(msg);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function showTyping(label) {
        const el     = document.createElement('div');
        el.className = 'chat-message msg-ai';
        el.id        = 'blinkTyping';
        el.innerHTML = `<span style="opacity:0.45;font-style:italic;">${label || 'Processing...'}</span>`;
        chatWindow.appendChild(el);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function removeTyping() {
        document.getElementById('blinkTyping')?.remove();
    }

    // ── Parse BlinkBot response for routing signal ──────────────────────────
    function parseBlinkResponse(text) {
        const clean = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        const routeMatch = clean.match(/route_to_server\s*\|\s*(?:context_packet[:\s]*)?([\s\S]*)/i);
        if (routeMatch) return { answer: null, packet: routeMatch[1].trim() };

        const direct = clean
            .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
            .replace(/<tool_call>[^<]*$/g, '')
            .trim();
        return { answer: direct || null, packet: null };
    }

    // ── Call local BlinkBot via Ollama ──────────────────────────────────────
    async function callBlinkBot(message, signal) {
        const messages = [{ role: 'system', content: systemPrompt }];
        history.slice(-8).forEach(h => messages.push(h));
        messages.push({ role: 'user', content: message });

        const res = await fetch(`${OLLAMA}/v1/chat/completions`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ model: BLINK_MODEL, messages, max_tokens: 1500, temperature: 0.7 }),
            signal
        });
        const data = await res.json();
        return data.choices[0].message.content;
    }

    // ── Call server BuddyBot ────────────────────────────────────────────────
    async function callBuddyBot(packet, signal) {
        const res = await fetch(buddyEndpoint, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                context_packet: packet,
                user_context:   userCtx
            }),
            signal
        });
        const data = await res.json();
        return data.answer || null;
    }

    // ── Send ────────────────────────────────────────────────────────────────
    async function sendMessage() {
        const message = input.value.trim();
        if (!message) return;

        input.value = '';
        addMessage(message, 'user', null);
        showTyping('BlinkBot thinking...');

        const controller = new AbortController();
        const timer      = setTimeout(() => controller.abort(), 120000);

        try {
            const raw              = await callBlinkBot(message, controller.signal);
            const { answer, packet } = parseBlinkResponse(raw);

            let final  = answer;
            let source = 'BlinkBot';

            if (packet) {
                removeTyping();
                showTyping('Routing to BuddyBot...');
                const buddyAnswer = await callBuddyBot(packet, controller.signal);
                if (buddyAnswer) {
                    final  = buddyAnswer;
                    source = 'BlinkBot → BuddyBot';
                }
            }

            clearTimeout(timer);
            removeTyping();

            if (final) {
                addMessage(final, 'assistant', source);
                history.push({ role: 'user',      content: message });
                history.push({ role: 'assistant',  content: final   });
                if (history.length > 20) history = history.slice(-20);
            } else {
                addMessage('No response — try again.', 'assistant', null);
            }

        } catch (err) {
            clearTimeout(timer);
            removeTyping();
            if (err.name === 'AbortError') {
                addMessage('Took too long. BuddyBot runs on CPU — try a shorter question.', 'assistant', null);
            } else {
                console.error('BlinkBot error:', err);
                addMessage('Something went wrong.', 'assistant', null);
            }
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

});
