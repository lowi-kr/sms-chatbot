// api.js — shared API client for all dashboard pages

const getApiUrl = () => sessionStorage.getItem('sms_api') || window.SMS_CORE_API_URL || '';
const getToken = () => sessionStorage.getItem('sms_token') || '';

// Auth guard — redirect to login if no token
function requireAuth() {
  if (!getToken()) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

// Generic fetch wrapper
async function apiFetch(path, options = {}) {
  const url = getApiUrl() + path;
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  });

  if (resp.status === 401) {
    sessionStorage.clear();
    window.location.href = 'login.html';
    throw new Error('Unauthorized');
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || 'API error');
  }

  return resp.json();
}

const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),
  delete: (path) => apiFetch(path, { method: 'DELETE' }),

  stats: () => api.get('/api/stats'),
  contacts: () => api.get('/api/contacts'),
  contactConversations: (phone) => api.get(`/api/contacts/${encodeURIComponent(phone)}/conversations`),
  conversationMessages: (id) => api.get(`/api/conversations/${id}/messages`),

  sendSMS: (to, message) => api.post('/api/send', { to, message }),

  blacklist: () => api.get('/api/blacklist'),
  addBlacklist: (phone, reason) => api.post('/api/blacklist', { phone_number: phone, reason }),
  removeBlacklist: (phone) => api.delete(`/api/blacklist/${encodeURIComponent(phone)}`),

  whitelist: () => api.get('/api/whitelist'),
  addWhitelist: (phone, label) => api.post('/api/whitelist', { phone_number: phone, label }),
  removeWhitelist: (phone) => api.delete(`/api/whitelist/${encodeURIComponent(phone)}`),

  logout: () => { sessionStorage.clear(); window.location.href = 'login.html'; },
};

// Shared toast notification system
function showToast(message, type = 'success') {
  const colors = { success: 'bg-green-900/80 border-green-500/40 text-green-300', error: 'bg-red-900/80 border-red-500/40 text-red-300', info: 'bg-blue-900/80 border-blue-500/40 text-blue-300' };
  const icons = { success: 'check_circle', error: 'error', info: 'info' };
  const t = document.createElement('div');
  t.className = `fixed bottom-6 right-6 z-[999] flex items-center gap-3 px-5 py-3.5 rounded-xl border backdrop-blur ${colors[type]} shadow-2xl`;
  t.style.cssText = 'animation: slideInRight 0.3s ease; font-family: Inter, sans-serif; font-size: 14px;';
  t.innerHTML = `<span style="font-family:'Material Symbols Outlined';font-size:18px">${icons[type]}</span><span>${message}</span>`;
  document.body.appendChild(t);
  setTimeout(() => { t.style.animation = 'slideOutRight 0.3s ease forwards'; setTimeout(() => t.remove(), 300); }, 3000);
}

// Shared modal
function showConfirm(message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[998] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="bg-[#0d1628] border border-[#1e2d4a] rounded-2xl p-7 max-w-sm w-full shadow-2xl" style="font-family:Inter,sans-serif">
      <div class="flex items-start gap-4 mb-6">
        <span style="font-family:'Material Symbols Outlined';font-size:24px;color:#ff5f7e;flex-shrink:0">warning</span>
        <p style="color:#c8d8f8;font-size:15px;line-height:1.6">${message}</p>
      </div>
      <div class="flex gap-3 justify-end">
        <button id="modal-cancel" class="px-5 py-2.5 rounded-lg text-sm" style="background:#1e2d4a;color:#c8d8f8;border:1px solid #2d3f60">Cancel</button>
        <button id="modal-confirm" class="px-5 py-2.5 rounded-lg text-sm font-semibold" style="background:#ff5f7e;color:white">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#modal-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#modal-confirm').onclick = () => { overlay.remove(); onConfirm(); };
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

// Inject global animation styles once
const styleTag = document.createElement('style');
styleTag.textContent = `
  @keyframes slideInRight { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
  @keyframes slideOutRight { from { opacity:1; transform:translateX(0); } to { opacity:0; transform:translateX(20px); } }
  .msym { font-family:'Material Symbols Outlined'; font-variation-settings:'FILL' 0,'wght' 300,'GRAD' 0,'opsz' 24; }
`;
document.head.appendChild(styleTag);
