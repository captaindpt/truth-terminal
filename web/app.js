function $(id) {
  return document.getElementById(id);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function newId(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function wsKey(workspaceId, suffix) {
  return `tt:ws:${workspaceId}:${suffix}`;
}

function setClock() {
  const el = $('clock');
  if (!el) return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  el.textContent = `${hh}:${mm}:${ss}`;
}

function appendTerminal(text) {
  const out = $('terminal-output');
  if (!out) return;
  const divider = out.textContent && out.textContent.trim().length ? '\n\n' : '';
  out.textContent = `${out.textContent || ''}${divider}${text}`;
  out.scrollTop = out.scrollHeight;
}

async function exec(line) {
  const res = await fetch('/api/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  return res.json();
}

async function fetchNews(q, limit) {
  const url = new URL('/api/news', window.location.origin);
  if (q && String(q).trim()) url.searchParams.set('q', String(q).trim());
  url.searchParams.set('limit', String(limit || 30));

  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'news error');
  return data.items || [];
}

async function chat(sessionId, message) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  return res.json();
}

function renderOutputs(outputs) {
  const lines = [];
  for (const o of outputs || []) {
    if (o.kind === 'error') {
      lines.push(`Error: ${o.message}`);
      continue;
    }
    if (o.kind === 'text') {
      if (o.title) lines.push(o.title);
      lines.push(o.text);
      continue;
    }
    if (o.kind === 'json') {
      if (o.title) lines.push(o.title);
      lines.push(JSON.stringify(o.value, null, 2));
      continue;
    }
    if (o.kind === 'table') {
      if (o.title) lines.push(o.title);
      const header = o.columns.join('  ');
      lines.push(header);
      lines.push(o.columns.map((c) => '-'.repeat(c.length)).join('  '));
      for (const row of o.rows || []) {
        lines.push(row.map((v) => String(v ?? '')).join('  '));
      }
      continue;
    }
  }
  return lines.join('\n');
}

function setTerminalOpen(open) {
  const overlay = $('terminal');
  if (!overlay) return;
  overlay.classList.toggle('is-open', open);
  overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) {
    const input = $('terminal-input');
    if (input) input.focus();
  }
}

function setWindowsMenuOpen(open) {
  const menu = $('windows-menu');
  if (!menu) return;
  menu.classList.toggle('is-open', open);
  menu.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function windowStorageKey(workspaceId, id) {
  return wsKey(workspaceId, `window:${id}:geom`);
}

function windowHiddenKey(workspaceId, id) {
  return wsKey(workspaceId, `window:${id}:hidden`);
}

function windowFocusKey(workspaceId) {
  return wsKey(workspaceId, 'window:focused');
}

function applyWindowGeometry(el, geom) {
  el.style.left = `${geom.x}px`;
  el.style.top = `${geom.y}px`;
  el.style.width = `${geom.w}px`;
  el.style.height = `${geom.h}px`;
}

function readWindowGeometry(el) {
  const x = Number(el.dataset.x || 12);
  const y = Number(el.dataset.y || 12);
  const w = Number(el.dataset.w || 480);
  const h = Number(el.dataset.h || 320);
  return { x, y, w, h };
}

function loadWindowGeometry(id, fallback) {
  try {
    const raw = localStorage.getItem(id);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.x === 'number' &&
      typeof parsed?.y === 'number' &&
      typeof parsed?.w === 'number' &&
      typeof parsed?.h === 'number'
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return fallback;
}

function saveWindowGeometry(storageKey, geom) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(geom));
  } catch {
    // ignore
  }
}

function bringToFront(el, state) {
  state.z += 1;
  el.style.zIndex = String(state.z);
}

function setupWindows(getWorkspaceId) {
  const desktop = $('desktop');
  if (!desktop) return;

  const windows = Array.from(desktop.querySelectorAll('.window'));
  const state = { z: 10 };
  const MIN_W = 320;
  const MIN_H = 180;

  function setFocused(target) {
    for (const w of windows) w.classList.remove('is-focused');
    target.classList.add('is-focused');
    try {
      localStorage.setItem(windowFocusKey(getWorkspaceId()), target.dataset.window || '');
    } catch {
      // ignore
    }
  }

  function focusWindowById(id) {
    const win = windows.find((w) => w.dataset.window === id);
    if (!win) return false;
    win.classList.remove('is-hidden');
    setFocused(win);
    bringToFront(win, state);
    try {
      localStorage.setItem(windowHiddenKey(getWorkspaceId(), id), '0');
    } catch {
      // ignore
    }
    return true;
  }

  function applyWorkspaceToWindows(workspaceId) {
    state.z = 10;
    for (const win of windows) {
      const id = win.dataset.window;
      if (!id) continue;

      const fallback = readWindowGeometry(win);
      const geom = loadWindowGeometry(windowStorageKey(workspaceId, id), fallback);
      applyWindowGeometry(win, geom);

      let hidden = false;
      try {
        hidden = localStorage.getItem(windowHiddenKey(workspaceId, id)) === '1';
      } catch {
        hidden = false;
      }
      win.classList.toggle('is-hidden', hidden);

      bringToFront(win, state);
    }

    // restore focus if possible
    let focusedId = '';
    try {
      focusedId = localStorage.getItem(windowFocusKey(workspaceId)) || '';
    } catch {
      focusedId = '';
    }
    if (focusedId && focusWindowById(focusedId)) return;
    focusWindowById('agent');
  }

  for (const win of windows) {
    const id = win.dataset.window;
    if (!id) continue;

    // geometry/visibility will be set in applyWorkspaceToWindows
    bringToFront(win, state);

    win.addEventListener('pointerdown', () => {
      setFocused(win);
      bringToFront(win, state);
    });

    const closeBtn = win.querySelector('.window-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        win.classList.add('is-hidden');
        try {
          localStorage.setItem(windowHiddenKey(getWorkspaceId(), id), '1');
        } catch {
          // ignore
        }
        renderWindowsMenu(windows);
      });
    }

    const handle = win.querySelector('[data-drag-handle]');
    if (handle) {
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (isTypingTarget(e.target)) return;

        setFocused(win);
        bringToFront(win, state);
        win.setPointerCapture(e.pointerId);

        const rect = win.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        const offsetX = startX - rect.left;
        const offsetY = startY - rect.top;

        const desktopRect = desktop.getBoundingClientRect();
        const maxX = desktopRect.width - rect.width;
        const maxY = desktopRect.height - rect.height;

        const onMove = (ev) => {
          const nextX = clamp(ev.clientX - desktopRect.left - offsetX, 0, Math.max(0, maxX));
          const nextY = clamp(ev.clientY - desktopRect.top - offsetY, 0, Math.max(0, maxY));
          win.style.left = `${nextX}px`;
          win.style.top = `${nextY}px`;
        };

        const onUp = () => {
          win.removeEventListener('pointermove', onMove);
          win.removeEventListener('pointerup', onUp);
          win.removeEventListener('pointercancel', onUp);

          const x = Number.parseFloat(win.style.left || '0');
          const y = Number.parseFloat(win.style.top || '0');
          const w = Number.parseFloat(win.style.width || String(rect.width));
          const h = Number.parseFloat(win.style.height || String(rect.height));
          saveWindowGeometry(windowStorageKey(getWorkspaceId(), id), { x, y, w, h });
        };

        win.addEventListener('pointermove', onMove);
        win.addEventListener('pointerup', onUp);
        win.addEventListener('pointercancel', onUp);
      });
    }

    const resize = win.querySelector('[data-resize-handle]');
    if (resize) {
      resize.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        setFocused(win);
        bringToFront(win, state);
        win.setPointerCapture(e.pointerId);

        const rect = win.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = rect.width;
        const startH = rect.height;

        const desktopRect = desktop.getBoundingClientRect();
        const left = rect.left - desktopRect.left;
        const top = rect.top - desktopRect.top;

        const maxW = desktopRect.width - left;
        const maxH = desktopRect.height - top;

        const onMove = (ev) => {
          const nextW = clamp(startW + (ev.clientX - startX), MIN_W, Math.max(MIN_W, maxW));
          const nextH = clamp(startH + (ev.clientY - startY), MIN_H, Math.max(MIN_H, maxH));
          win.style.width = `${nextW}px`;
          win.style.height = `${nextH}px`;
        };

        const onUp = () => {
          win.removeEventListener('pointermove', onMove);
          win.removeEventListener('pointerup', onUp);
          win.removeEventListener('pointercancel', onUp);

          const x = Number.parseFloat(win.style.left || String(left));
          const y = Number.parseFloat(win.style.top || String(top));
          const w = Number.parseFloat(win.style.width || String(startW));
          const h = Number.parseFloat(win.style.height || String(startH));
          saveWindowGeometry(windowStorageKey(getWorkspaceId(), id), { x, y, w, h });
        };

        win.addEventListener('pointermove', onMove);
        win.addEventListener('pointerup', onUp);
        win.addEventListener('pointercancel', onUp);
      });
    }
  }

  function renderWindowsMenu(windowsEls) {
    const list = $('windows-list');
    if (!list) return;
    list.innerHTML = '';
    for (const win of windowsEls) {
      const id = win.dataset.window || 'window';
      const title = win.dataset.title || id;
      const isOpen = !win.classList.contains('is-hidden');

      const row = document.createElement('div');
      row.className = 'menu-item';

      const name = document.createElement('div');
      name.className = 'menu-item-title';
      name.textContent = title;

      const btn = document.createElement('button');
      btn.className = 'menu-item-btn';
      btn.type = 'button';
      btn.textContent = isOpen ? 'Focus' : 'Open';
      btn.addEventListener('click', () => {
        win.classList.remove('is-hidden');
        try {
          localStorage.setItem(windowHiddenKey(getWorkspaceId(), id), '0');
        } catch {
          // ignore
        }
        setFocused(win);
        bringToFront(win, state);
        setWindowsMenuOpen(false);
      });

      row.appendChild(name);
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  renderWindowsMenu(windows);

  const winBtn = $('windows-btn');
  const winClose = $('windows-close');
  if (winBtn) {
    winBtn.addEventListener('click', () => {
      const menu = $('windows-menu');
      const open = menu && menu.classList.contains('is-open');
      renderWindowsMenu(windows);
      setWindowsMenuOpen(!open);
    });
  }
  if (winClose) {
    winClose.addEventListener('click', () => setWindowsMenuOpen(false));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const menu = $('windows-menu');
      const open = menu && menu.classList.contains('is-open');
      if (open) {
        e.preventDefault();
        setWindowsMenuOpen(false);
      }
    }
  });

  applyWorkspaceToWindows(getWorkspaceId());

  return { renderWindowsMenu, focusWindowById, applyWorkspaceToWindows };
}

function setupTerminal() {
  const form = $('terminal-form');
  const input = $('terminal-input');
  const close = $('terminal-close');

  if (close) {
    close.addEventListener('click', () => setTerminalOpen(false));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === '`' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      const overlay = $('terminal');
      const open = overlay && overlay.classList.contains('is-open');
      setTerminalOpen(!open);
      return;
    }
    if (e.key === 'Escape') {
      const overlay = $('terminal');
      const open = overlay && overlay.classList.contains('is-open');
      if (open) {
        e.preventDefault();
        setTerminalOpen(false);
      }
    }
  });

  if (form && input) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const line = input.value.trim();
      if (!line) return;
      input.value = '';
      appendTerminal(`tt> ${line}`);
      try {
        const outputs = await exec(line);
        appendTerminal(renderOutputs(outputs));
      } catch (err) {
        appendTerminal(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }
}

function setupChips() {
  const chips = document.querySelectorAll('.chip[data-cmd]');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function appendChatMessage(role, text) {
  const chatEl = $('chat');
  if (!chatEl) return;
  const row = document.createElement('div');
  row.className = `chat-msg chat-${role}`;

  const meta = document.createElement('div');
  meta.className = 'chat-meta';
  meta.textContent = role === 'assistant' ? 'agent' : 'you';

  const body = document.createElement('div');
  body.className = 'chat-body';
  body.innerHTML = escapeHtml(text).replaceAll('\n', '<br/>');

  row.appendChild(meta);
  row.appendChild(body);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function setPinnedUserPrompt(text) {
  const pin = $('chat-pin');
  if (!pin) return;
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    pin.classList.remove('is-visible');
    pin.setAttribute('aria-hidden', 'true');
    pin.textContent = '';
    return;
  }
  pin.textContent = trimmed;
  pin.classList.add('is-visible');
  pin.setAttribute('aria-hidden', 'false');
}

function appendIntelEvent(event) {
  const intelEl = $('intel');
  if (!intelEl) return;

  const item = document.createElement('div');
  item.className = 'intel-item';
  item.dataset.targetWindow = event.targetWindow || 'intel';

  const title = document.createElement('div');
  title.className = 'intel-title';
  title.textContent = `${event.title || 'tool'}: ${event.command || ''}`.trim();

  const body = document.createElement('div');
  body.className = 'intel-body';
  const outputs = event.outputs || [];
  body.textContent = Array.isArray(outputs) ? renderOutputs(outputs) : JSON.stringify(outputs, null, 2);

  item.appendChild(title);
  item.appendChild(body);
  item.addEventListener('click', () => {
    if (windowManager?.focusWindowById) {
      windowManager.focusWindowById(item.dataset.targetWindow);
    }
  });

  intelEl.prepend(item);
}

function getSessionId() {
  // kept for backward compat; workspace-aware version is below
  return 'default';
}

function setupChat(getWorkspaceId) {
  const form = $('chat-form');
  const input = $('chat-input');
  if (!form || !input) return;

  const chatEl = $('chat');
  const pinEl = $('chat-pin');

  function clearChatMessages() {
    if (!chatEl) return;
    const keep = pinEl ? [pinEl] : [];
    chatEl.innerHTML = '';
    for (const n of keep) chatEl.appendChild(n);
  }

  function getChatSessionId(workspaceId) {
    const key = wsKey(workspaceId, 'chat:sessionId');
    let id = null;
    try {
      id = localStorage.getItem(key);
    } catch {
      id = null;
    }
    if (!id) {
      id = newId('sess');
      try {
        localStorage.setItem(key, id);
      } catch {
        // ignore
      }
    }
    return id;
  }

  function loadPinned(workspaceId) {
    let last = '';
    try {
      last = localStorage.getItem(wsKey(workspaceId, 'chat:lastUserMessage')) || '';
    } catch {
      last = '';
    }
    setPinnedUserPrompt(last);
  }

  function persistPinned(workspaceId, message) {
    try {
      localStorage.setItem(wsKey(workspaceId, 'chat:lastUserMessage'), message);
    } catch {
      // ignore
    }
  }

  function loadWorkspace(workspaceId) {
    clearChatMessages();
    loadPinned(workspaceId);
    appendChatMessage('assistant', `Workspace: ${workspaceId}`);
    appendChatMessage('assistant', 'Use /exec to run tools, e.g. "/exec grok <query>".');
  }

  loadWorkspace(getWorkspaceId());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = '';

    appendChatMessage('user', message);
    setPinnedUserPrompt(message);
    persistPinned(getWorkspaceId(), message);

    try {
      const resp = await chat(getChatSessionId(getWorkspaceId()), message);
      if (resp?.assistant) appendChatMessage('assistant', resp.assistant);
      for (const ev of resp?.events || []) appendIntelEvent(ev);
      if (resp?.events?.length && windowManager?.focusWindowById) {
        windowManager.focusWindowById('intel');
      }
    } catch (err) {
      appendChatMessage('assistant', `Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return { loadWorkspace };
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function setupNews(getWorkspaceId) {
  const form = $('news-form');
  const input = $('news-input');
  const list = $('news');
  const status = $('news-status');
  if (!form || !input || !list || !status) return;

  let query = '';

  const seen = new Set();
  let pollTimer = null;

  function renderItem(item) {
    const row = document.createElement('div');
    row.className = 'news-item';

    const top = document.createElement('div');
    top.className = 'news-topline';
    const left = document.createElement('span');
    left.className = 'news-time';
    left.textContent = formatTime(item.publishedAt || '');
    const right = document.createElement('span');
    right.className = 'news-source';
    right.textContent = item.source || '';
    top.appendChild(left);
    top.appendChild(right);

    const title = document.createElement('div');
    title.className = 'news-title';
    const a = document.createElement('a');
    a.href = item.url;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.textContent = item.title;
    title.appendChild(a);

    row.appendChild(top);
    row.appendChild(title);
    return row;
  }

  async function poll() {
    try {
      status.textContent = 'loading';
      const items = await fetchNews(query, 30);
      status.textContent = `ok ${items.length}`;

      let added = 0;
      for (const item of items) {
        const dedupeKey = item.url;
        if (!dedupeKey || seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        list.prepend(renderItem(item));
        added++;
      }

      if (added > 0) {
        // keep scroll position stable if user isn't at top
        // (simple version: do nothing; prepend changes are usually fine)
      }
    } catch (err) {
      status.textContent = 'err';
      const message = err instanceof Error ? err.message : String(err);
      const row = document.createElement('div');
      row.className = 'news-item';
      row.textContent = `Error: ${message}`;
      list.prepend(row);
    }
  }

  function start() {
    if (pollTimer) clearInterval(pollTimer);
    poll();
    pollTimer = setInterval(poll, 15000);
  }

  function reset(newQuery) {
    query = String(newQuery || '').trim();
    try {
      localStorage.setItem(wsKey(getWorkspaceId(), 'news:q'), query);
    } catch {
      // ignore
    }
    list.innerHTML = '';
    seen.clear();
    start();
  }

  function loadWorkspace(workspaceId) {
    let q = '';
    try {
      q = localStorage.getItem(wsKey(workspaceId, 'news:q')) || '';
    } catch {
      q = '';
    }
    input.value = q;
    reset(q);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    reset(input.value);
  });

  loadWorkspace(getWorkspaceId());

  return { loadWorkspace };
}

function setupWorkspaces() {
  const tabsEl = $('ws-tabs');
  const addEl = $('ws-add');
  if (!tabsEl || !addEl) return null;

  const LIST_KEY = 'tt:workspaces';
  const CURRENT_KEY = 'tt:workspace:current';

  function loadList() {
    try {
      const raw = localStorage.getItem(LIST_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((w) => w && typeof w.id === 'string' && typeof w.name === 'string');
    } catch {
      // ignore
    }
    return null;
  }

  function saveList(list) {
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
  }

  function getCurrentId() {
    try {
      return localStorage.getItem(CURRENT_KEY) || 'default';
    } catch {
      return 'default';
    }
  }

  function setCurrentId(id) {
    try {
      localStorage.setItem(CURRENT_KEY, id);
    } catch {
      // ignore
    }
  }

  let workspaces = loadList();
  if (!workspaces || workspaces.length === 0) {
    workspaces = [{ id: 'default', name: 'Main' }];
    saveList(workspaces);
    setCurrentId('default');
  }

  if (!workspaces.some((w) => w.id === getCurrentId())) {
    setCurrentId(workspaces[0].id);
  }

  const listeners = [];

  function notify(id) {
    for (const fn of listeners) fn(id);
  }

  function render() {
    const current = getCurrentId();
    tabsEl.innerHTML = '';

    for (const ws of workspaces) {
      const tab = document.createElement('div');
      tab.className = `ws-tab${ws.id === current ? ' is-active' : ''}`;
      tab.dataset.wsId = ws.id;

      const name = document.createElement('div');
      name.className = 'ws-tab-name';
      name.textContent = ws.name;

      tab.appendChild(name);

      if (workspaces.length > 1) {
        const close = document.createElement('button');
        close.className = 'ws-tab-close';
        close.type = 'button';
        close.textContent = '×';
        close.title = 'Remove workspace';
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          removeWorkspace(ws.id);
        });
        tab.appendChild(close);
      }

      tab.addEventListener('click', () => switchTo(ws.id));
      tab.addEventListener('dblclick', () => {
        const next = prompt('Rename workspace', ws.name);
        if (next && next.trim()) {
          ws.name = next.trim();
          saveList(workspaces);
          render();
        }
      });

      tabsEl.appendChild(tab);
    }
  }

  function switchTo(id) {
    if (!workspaces.some((w) => w.id === id)) return;
    if (id === getCurrentId()) return;
    setCurrentId(id);
    render();
    notify(id);
  }

  function addWorkspace(name) {
    const id = newId('ws');
    workspaces.push({ id, name });
    saveList(workspaces);
    setCurrentId(id);
    render();
    notify(id);
  }

  function removeWorkspace(id) {
    if (workspaces.length <= 1) return;
    const idx = workspaces.findIndex((w) => w.id === id);
    if (idx === -1) return;
    const wasCurrent = id === getCurrentId();
    workspaces.splice(idx, 1);
    saveList(workspaces);
    if (wasCurrent) {
      const next = workspaces[Math.max(0, idx - 1)]?.id || workspaces[0].id;
      setCurrentId(next);
      render();
      notify(next);
    } else {
      render();
    }
  }

  addEl.addEventListener('click', () => {
    const base = `WS ${workspaces.length + 1}`;
    const name = prompt('Workspace name', base);
    if (!name) return;
    addWorkspace(name.trim() || base);
  });

  render();

  return {
    getCurrentId,
    onChange: (fn) => listeners.push(fn),
    render,
    switchTo
  };
}

const workspaceManager = setupWorkspaces();
const windowManager = setupWindows(() => (workspaceManager ? workspaceManager.getCurrentId() : 'default'));
const chatManager = setupChat(() => (workspaceManager ? workspaceManager.getCurrentId() : 'default'));
const newsManager = setupNews(() => (workspaceManager ? workspaceManager.getCurrentId() : 'default'));

if (workspaceManager) {
  workspaceManager.onChange((wsId) => {
    windowManager?.applyWorkspaceToWindows?.(wsId);
    chatManager?.loadWorkspace?.(wsId);
    newsManager?.loadWorkspace?.(wsId);
  });
}

setInterval(setClock, 1000);
setClock();
setupTerminal();
setupChips();
