document.addEventListener('DOMContentLoaded', async () => {

    const downloadState = document.getElementById('blinkDownloadState');
    const chatState     = document.getElementById('blinkChatState');
    const chatWindow    = document.getElementById('blinkChatWindow');
    const input         = document.getElementById('blinkInput');
    const sendBtn       = document.getElementById('sendBlinkBtn');

    const WLLAMA_CDN = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2';

    let history      = [];
    let systemPrompt = '';
    let userCtx      = {};
    let wllama       = null;
    let modelLoaded  = false;

    // ── Fetch context + model URL from server ───────────────────────────────
    async function loadContext() {
        try {
            const res = await fetch('/pug/api/blinkbot-context');
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
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

    // ── Model loading UI ────────────────────────────────────────────────────
    function showLoadingUI() {
        downloadState.innerHTML = `
            <div style="padding:20px;display:flex;flex-direction:column;gap:14px;">
                <div style="font-size:1.3rem;font-family:var(--font-mono);font-weight:700;letter-spacing:0.1em;color:#4a7aaa;">
                    BLINK<span style="color:var(--text-dim);">BOT</span>
                </div>
                <p style="color:var(--text-dim);font-size:0.76rem;line-height:1.6;margin:0;">
                    Loading to your device — first time only.
                </p>
                <div style="background:rgba(255,255,255,0.06);border-radius:6px;height:5px;overflow:hidden;">
                    <div id="blinkBar" style="height:100%;width:0%;background:#4a7aaa;transition:width 0.25s ease;"></div>
                </div>
                <div id="blinkLoadMsg" style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-dim);opacity:0.55;">
                    Initializing...
                </div>
            </div>`;
    }

    function updateProgress(loaded, total, msg) {
        const bar   = document.getElementById('blinkBar');
        const label = document.getElementById('blinkLoadMsg');
        if (bar && total > 0) bar.style.width = Math.round((loaded / total) * 100) + '%';
        if (label && msg)     label.textContent = msg;
    }

    // ── ChatML formatter for Qwen ───────────────────────────────────────────
    function formatChatML(messages) {
        let p = '';
        for (const m of messages) {
            p += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
        }
        return p + '<|im_start|>assistant\n';
    }

    // ── Load wllama engine + GGUF model ─────────────────────────────────────
    async function initWllama(modelUrl) {
        updateProgress(0, 1, 'Loading engine...');

        const { Wllama } = await import(WLLAMA_CDN + '/esm/index.js');
        wllama = new Wllama({
            'single-thread/wllama.wasm': WLLAMA_CDN + '/src/single-thread/wllama.wasm',
            'multi-thread/wllama.wasm':  WLLAMA_CDN + '/src/multi-thread/wllama.wasm',
        });

        updateProgress(0, 1, 'Downloading model...');
        await wllama.loadModelFromUrl(modelUrl, {
            allowOffline: true,
            progressCallback: ({ loaded, total }) => {
                const mb = (loaded / 1048576).toFixed(0);
                const tb = (total  / 1048576).toFixed(0);
                updateProgress(loaded, total, `${mb} / ${tb} MB`);
            },
        });

        modelLoaded = true;
        updateProgress(1, 1, 'Ready.');
    }

    // ── On-device inference ─────────────────────────────────────────────────
    async function callBlinkLocal(message) {
        const msgs = [{ role: 'system', content: systemPrompt }];
        history.slice(-8).forEach(h => msgs.push(h));
        msgs.push({ role: 'user', content: message });

        const raw = await wllama.createCompletion(formatChatML(msgs), {
            nPredict: 512,
            sampling: { temp: 0.7, top_p: 0.9 },
        });
        return raw.split('<|im_end|>')[0].trim();
    }

    // ── Server call — Groq (free) or BuddyBot (premium, server decides) ─────
    async function callServer(message, signal) {
        const res = await fetch('/pug/api/blinkbot', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ message, history: history.slice(-12) }),
            signal,
        });
        const data = await res.json();
        return data.answer || null;
    }

    // ── Detect route_to_server signal from BlinkBot ─────────────────────────
    function parseBlinkResponse(text) {
        const clean = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (/route_to_server/i.test(clean)) return { answer: null, route: true };
        const direct = clean.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
        return { answer: direct || null, route: false };
    }

    // ── Chat helpers ─────────────────────────────────────────────────────────
    function addMessage(text, role, source) {
        const msg     = document.createElement('div');
        msg.className = `chat-message msg-${role === 'assistant' ? 'ai' : 'user'}`;
        const body    = (role === 'assistant' && typeof marked !== 'undefined')
            ? marked.parse(text) : text;
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
        el.innerHTML = `<span style="opacity:0.45;font-style:italic;">${label || 'Thinking...'}</span>`;
        chatWindow.appendChild(el);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function removeTyping() { document.getElementById('blinkTyping')?.remove(); }

    // ── Send ─────────────────────────────────────────────────────────────────
    async function sendMessage() {
        const message = input.value.trim();
        if (!message) return;

        input.value = '';
        addMessage(message, 'user', null);

        const controller = new AbortController();
        const timer      = setTimeout(() => controller.abort(), 120000);

        try {
            let final  = null;
            let source = null;

            if (modelLoaded) {
                showTyping('BlinkBot thinking...');
                const raw              = await callBlinkLocal(message);
                const { answer, route } = parseBlinkResponse(raw);

                if (route || !answer) {
                    removeTyping();
                    showTyping('Thinking harder...');
                    final  = await callServer(message, controller.signal);
                    source = 'BlinkBot → server';
                } else {
                    final  = answer;
                    source = 'BlinkBot';
                }
            } else {
                showTyping('Thinking...');
                final  = await callServer(message, controller.signal);
                source = 'server';
            }

            clearTimeout(timer);
            removeTyping();

            if (final) {
                addMessage(final, 'assistant', source);
                history.push({ role: 'user',     content: message });
                history.push({ role: 'assistant', content: final   });
                if (history.length > 20) history = history.slice(-20);
            } else {
                addMessage('No response — try again.', 'assistant', null);
            }

        } catch (err) {
            clearTimeout(timer);
            removeTyping();
            if (err.name === 'AbortError') {
                addMessage('Took too long — try a shorter question.', 'assistant', null);
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

    // ── Boot ─────────────────────────────────────────────────────────────────
    const ctx = await loadContext();
    if (!ctx) {
        downloadState.innerHTML = '<p style="padding:20px;color:var(--text-dim);font-size:0.75rem;">Could not load context. Please refresh.</p>';
        return;
    }

    systemPrompt = ctx.system_prompt || '';
    userCtx      = ctx.user_context  || {};

    if (ctx.model_url) {
        showLoadingUI();
        try {
            await initWllama(ctx.model_url);
        } catch (e) {
            console.warn('wllama load failed, server-only mode:', e);
            // still activate — server fallback handles all messages
        }
        activateChat();
    } else {
        // No model on server — server-only mode
        downloadState.innerHTML = `
            <div style="padding:20px;display:flex;flex-direction:column;gap:12px;">
                <div style="font-size:1.3rem;font-family:var(--font-mono);font-weight:700;letter-spacing:0.1em;color:#4a7aaa;">
                    BLINK<span style="color:var(--text-dim);">BOT</span>
                </div>
                <p style="color:var(--text-dim);font-size:0.76rem;line-height:1.6;margin:0;">Running via server.</p>
                <button id="blinkServerBtn" style="font-size:0.75rem;padding:8px 16px;cursor:pointer;border-radius:6px;background:#4a7aaa;color:#fff;border:none;align-self:flex-start;">
                    Start chatting
                </button>
            </div>`;
        document.getElementById('blinkServerBtn').addEventListener('click', activateChat);
    }

});
