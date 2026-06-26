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
  #chat-area { height: 400px; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .msg-bubble { max-width: 85%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
  .msg-user { background: rgba(79,124,255,0.12); border: 1px solid rgba(79,124,255,0.2); align-self: flex-start; border-bottom-left-radius: 4px; }
  .msg-ai { background: #111e35; border: 1px solid #1e2d4a; align-self: flex-end; border-bottom-right-radius: 4px; }
  .msg-meta { font-size: 10px; color: #4a5980; font-family: 'SF Mono', Consolas, monospace; margin-top: 3px; }
  .spin { display: inline-block; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .empty-state { text-align: center; color: #4a5980; margin-top: 40px; font-size: 13px; }
  .toast { position: fixed; bottom: 20px; right: 20px; background: rgba(255,95,126,0.92); color: white; padding: 10px 16px; border-radius: 8px; font-size: 13px; z-index: 50; }

  /* Model picker */
  .model-picker { position: relative; }
  .model-picker-trigger { display: flex; align-items: center; justify-content: space-between; cursor: pointer; gap: 8px; }
  .model-picker-trigger span.chev { color: #4a5980; font-size: 11px; }
  .model-dropdown { position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: #0d1628; border: 1px solid #2d3f60; border-radius: 10px; box-shadow: 0 16px 40px rgba(0,0,0,0.5); z-index: 30; display: none; max-height: 320px; overflow: hidden; flex-direction: column; }
  .model-dropdown.open { display: flex; }
  .model-search { border: none; border-bottom: 1px solid #1e2d4a; border-radius: 0; background: #090f1e; }
  .model-list { overflow-y: auto; flex: 1; }
  .model-option { padding: 9px 14px; cursor: pointer; font-size: 12.5px; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .model-option:hover { background: rgba(79,124,255,0.08); }
  .model-option .mid { font-family: 'SF Mono', Consolas, monospace; color: #c8d8f8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .model-option .mtag { font-size: 10px; color: #22d3a5; font-family: 'SF Mono', Consolas, monospace; flex-shrink: 0; }
  .model-empty { padding: 16px; text-align: center; color: #4a5980; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🧪 SMS Chatbot — Test Console</h1>
  <p class="sub">Talk to the bot directly. No phone, no Telnyx, no dashboard login — this page is served by the worker itself.</p>

  <div class="card" style="padding:16px 18px;margin-bottom:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
    <div>
      <label class="field-label">Test Phone Number</label>
      <input id="test-number" class="field-input" value="+15555550100" />
    </div>
    <div class="model-picker" id="model-picker">
      <label class="field-label">Model (blank = use dashboard default)</label>
      <div class="field-input model-picker-trigger" id="model-trigger" onclick="toggleModelDropdown()">
        <span id="model-trigger-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Default</span>
        <span class="chev">▾</span>
      </div>
      <div class="model-dropdown" id="model-dropdown">
        <input class="field-input model-search" id="model-search" placeholder="Search models..." oninput="filterModels()" />
        <div class="model-list" id="model-list">
          <div class="model-empty">Loading models...</div>
        </div>
      </div>
    </div>
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
    Enter to send · Shift+Enter for a new line · Calls <code style="background:#0d1628;padding:1px 5px;border-radius:4px">/test</code> on this same worker · Requires <code style="background:#0d1628;padding:1px 5px;border-radius:4px">TEST_MODE=true</code>
  </p>
</div>

<script>
  let allModels = [];
  let selectedModel = '';

  // ---- Model picker ----
  async function loadModels() {
    const list = document.getElementById('model-list');
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/models');
      const data = await resp.json();
      allModels = (data.data || []).map(m => ({ id: m.id, name: m.name, isFree: m.id.endsWith(':free') }))
        .sort((a, b) => a.id.localeCompare(b.id));
      renderModelList(allModels);
    } catch (e) {
      list.innerHTML = '<div class="model-empty">Failed to load model list: ' + e.message + '</div>';
    }
  }

  function renderModelList(models) {
    const list = document.getElementById('model-list');
    if (!models.length) { list.innerHTML = '<div class="model-empty">No matching models</div>'; return; }
    const defaultOpt = '<div class="model-option" onclick="pickModel(\\'\\')"><span class="mid">(Default — use dashboard setting)</span></div>';
    list.innerHTML = defaultOpt + models.map(m =>
      '<div class="model-option" onclick="pickModel(\\'' + m.id.replace(/'/g, "\\\\'") + '\\')">' +
        '<span class="mid">' + m.id + '</span>' +
        (m.isFree ? '<span class="mtag">FREE</span>' : '') +
      '</div>'
    ).join('');
  }

  function filterModels() {
    const q = document.getElementById('model-search').value.toLowerCase();
    renderModelList(allModels.filter(m => m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)));
  }

  function pickModel(id) {
    selectedModel = id;
    document.getElementById('model-trigger-label').textContent = id || 'Default';
    closeModelDropdown();
  }

  function toggleModelDropdown() {
    document.getElementById('model-dropdown').classList.toggle('open');
    document.getElementById('model-search').focus();
  }

  function closeModelDropdown() {
    document.getElementById('model-dropdown').classList.remove('open');
  }

  document.addEventListener('click', function(e) {
    const picker = document.getElementById('model-picker');
    if (!picker.contains(e.target)) closeModelDropdown();
  });

  // ---- Chat ----
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
        body: JSON.stringify({ from: phone, text, model: selectedModel || undefined }),
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTest();
    }
  });

  function clearChat() {
    document.getElementById('chat-area').innerHTML = '<div class="empty-state" id="empty-state">Send a message below to start testing. Replies come straight from the worker — no SMS is sent.</div>';
  }

  document.getElementById('chat-input').focus();
  loadModels();
</script>
</body>
</html>
`;
