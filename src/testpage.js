// testpage.js - Standalone test UI served directly by the main worker at GET /test-ui
// No auth, no dashboard, no Telnyx — purely talks to this worker's own /test endpoint.

export const TEST_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>SMS Chatbot — Test Console</title>
<style>
  * { box-sizing: border-box; }
  body {
    background: #060c1a; color: #c8d8f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .wrap { max-width: 640px; width: 100%; }
  h1 { font-size: 20px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.01em; }
  .sub { font-size: 13px; color: #4a5980; margin: 0 0 20px; }
  .card { background: #0d1628; border: 1px solid #1e2d4a; border-radius: 12px; }
  .field-label { display:block; font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#4a5980; margin-bottom:6px; font-family: 'SF Mono', Consolas, monospace; }
  .field-input { background:#090f1e; border:1px solid #1e2d4a; color:#c8d8f8; border-radius:8px; padding:10px 14px; font-size:14px; outline:none; width:100%; font-family: 'SF Mono', Consolas, monospace; }
  .field-input:focus { border-color:#4f7cff; }
  textarea.field-input { resize: vertical; min-height: 70px; font-family: inherit; }
  .btn { display:inline-flex; align-items:center; gap:6px; padding:9px 16px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; border:none; background:#4f7cff; color:white; }
  .btn:hover { background:#6b93ff; }
  .btn:disabled { opacity: 0.6; cursor: default; }
  .btn-ghost { background: transparent; color: #4a5980; border: 1px solid #1e2d4a; font-weight: 500; }
  .btn-ghost:hover { color: #c8d8f8; border-color: #2d3f60; background: rgba(255,255,255,0.03); }
  #chat-area { height: 420px; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .msg-bubble { max-width: 85%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
  .msg-user { background: rgba(79,124,255,0.12); border: 1px solid rgba(79,124,255,0.2); align-self: flex-start; border-bottom-left-radius: 4px; }
  .msg-ai { background: #111e35; border: 1px solid #1e2d4a; align-self: flex-end; border-bottom-right-radius: 4px; }
  .msg-meta { font-size: 10px; color: #4a5980; font-family: 'SF Mono', Consolas, monospace; margin-top: 3px; }
  .spin { display: inline-block; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .empty-state { text-align: center; color: #4a5980; margin-top: 40px; font-size: 13px; }
  .toast { position: fixed; bottom: 20px; right: 20px; background: rgba(255,95,126,0.92); color: white; padding: 10px 16px; border-radius: 8px; font-size: 13px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🧪 SMS Chatbot — Test Console</h1>
  <p class="sub">Talk to the bot directly. No phone, no Telnyx, no dashboard login — this page is served by the worker itself.</p>

  <div class="card" style="padding:16px 18px;margin-bottom:14px">
    <label class="field-label">Test Phone Number (used as the DB key — doesn't need to be real)</label>
    <input id="test-number" class="field-input" value="+15555550100" />
  </div>

  <div class="card" style="display:flex;flex-direction:column">
    <div id="chat-area">
      <div class="empty-state" id="empty-state">Send a message below to start testing. Replies come straight from the worker — no SMS is sent.</div>
    </div>
    <div style="padding:12px 16px;border-top:1px solid #1e2d4a;display:flex;gap:8px">
      <textarea id="chat-input" class="field-input" placeholder="Type a message, or /help, /new, etc..." rows="2"></textarea>
      <div style="display:flex;flex-direction:column;gap:8px;justify-content:flex-end">
        <button class="btn" onclick="sendTest()" id="send-btn">Send</button>
        <button class="btn btn-ghost" onclick="clearChat()">Clear</button>
      </div>
    </div>
  </div>

  <p style="font-size:11px;color:#4a5980;margin-top:12px;text-align:center">
    Ctrl/Cmd + Enter to send · Calls <code style="background:#0d1628;padding:1px 5px;border-radius:4px">/test</code> on this same worker · Requires <code style="background:#0d1628;padding:1px 5px;border-radius:4px">TEST_MODE=true</code>
  </p>
</div>

<script>
  function appendMessage(role, text, meta) {
    const area = document.getElementById('chat-area');
    const empty = document.getElementById('empty-state');
    if (empty) empty.remove();

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = role === 'user' ? 'flex-start' : 'flex-end';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble ' + (role === 'user' ? 'msg-user' : 'msg-ai');
    bubble.textContent = text;
    wrap.appendChild(bubble);

    if (meta) {
      const metaEl = document.createElement('div');
      metaEl.className = 'msg-meta';
      metaEl.style.alignSelf = role === 'user' ? 'flex-start' : 'flex-end';
      metaEl.textContent = meta;
      wrap.appendChild(metaEl);
    }

    area.appendChild(wrap);
    area.scrollTop = area.scrollHeight;
  }

  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  async function sendTest() {
    const input = document.getElementById('chat-input');
    const numberField = document.getElementById('test-number');
    const text = input.value.trim();
    const phone = numberField.value.trim();
    if (!text || !phone) { showToast('Enter a message and test number'); return; }

    appendMessage('user', text);
    input.value = '';

    const btn = document.getElementById('send-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin">&#8635;</span>';

    try {
      const resp = await fetch('/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: phone, text }),
      });

      const data = await resp.json().catch(() => null);

      if (!resp.ok || !data) {
        appendMessage('assistant', 'Error: worker returned ' + resp.status + '. Is TEST_MODE=true set?');
        return;
      }

      if (data.status === 'error') {
        appendMessage('assistant', 'Error: ' + data.error);
        return;
      }

      const reply = data.reply || '(no reply text returned)';
      let meta = 'status: ' + data.status;
      if (data.modelUsed) meta += ' · model: ' + data.modelUsed;
      if (data.inputTokens !== undefined) meta += ' · tokens in/out: ' + data.inputTokens + '/' + data.outputTokens;
      appendMessage('assistant', reply, meta);

    } catch (e) {
      appendMessage('assistant', 'Request failed: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Send';
    }
  }

  document.getElementById('chat-input').addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') sendTest();
  });

  function clearChat() {
    document.getElementById('chat-area').innerHTML = '<div class="empty-state" id="empty-state">Send a message below to start testing. Replies come straight from the worker — no SMS is sent.</div>';
  }

  document.getElementById('chat-input').focus();
</script>
</body>
</html>
`;
