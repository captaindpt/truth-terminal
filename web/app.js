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

const WINDOW_SPECS = [
  { type: 'window', id: 'agent', title: 'Agent', chip: 'AGT', multi: false },
  { type: 'window', id: 'des', title: 'Description', chip: 'DES', multi: false },
  { type: 'window', id: 'exec', title: 'Execution', chip: 'EXEC', multi: false },
  { type: 'kind', kind: 'book', title: 'Order Book', chip: 'BOOK', multi: true },
  { type: 'window', id: 'watchlist', title: 'Watchlist / Conviction', chip: 'WL', multi: false },
  { type: 'window', id: 'calendar', title: 'Information Calendar', chip: 'CAL', multi: false },
  { type: 'window', id: 'portfolio', title: 'Portfolio', chip: 'PF', multi: false },
  { type: 'window', id: 'rules', title: 'Rules', chip: 'RULE', multi: false },
  { type: 'window', id: 'news', title: 'News', chip: 'N', multi: false },
  { type: 'window', id: 'opt', title: 'Option Chain', chip: 'OPT', multi: false },
  { type: 'window', id: 'poly', title: 'Polymarket', chip: 'POLY', multi: false },
  { type: 'window', id: 'intel', title: 'Intel', chip: 'INT', multi: false },
  { type: 'window', id: 'tape', title: 'Tape / Feed', chip: 'TAPE', multi: false }
];

const WINDOW_ORDER_INDEX = new Map();
const WINDOW_SPEC_BY_WINDOW_ID = new Map();
const WINDOW_SPEC_BY_KIND = new Map();
for (let i = 0; i < WINDOW_SPECS.length; i += 1) {
  const spec = WINDOW_SPECS[i];
  if (spec.type === 'kind') {
    WINDOW_ORDER_INDEX.set(`kind:${spec.kind}`, i);
    WINDOW_SPEC_BY_KIND.set(spec.kind, spec);
  } else {
    WINDOW_ORDER_INDEX.set(`window:${spec.id}`, i);
    WINDOW_SPEC_BY_WINDOW_ID.set(spec.id, spec);
  }
}

function chipBaseLabelForWindowEl(win) {
  const kind = String(win?.dataset?.kind || '').trim();
  if (kind && WINDOW_SPEC_BY_KIND.has(kind)) return WINDOW_SPEC_BY_KIND.get(kind).chip;
  const id = String(win?.dataset?.window || '').trim();
  if (id && WINDOW_SPEC_BY_WINDOW_ID.has(id)) return WINDOW_SPEC_BY_WINDOW_ID.get(id).chip;
  const title = String(win?.dataset?.title || id || kind || 'WIN').trim();
  const compact = title.replaceAll(/[^A-Za-z0-9]+/g, '');
  return (compact.slice(0, 8) || 'WIN').toUpperCase();
}

function windowOrderIndexForWindowEl(win) {
  const kind = String(win?.dataset?.kind || '').trim();
  if (kind) {
    const idx = WINDOW_ORDER_INDEX.get(`kind:${kind}`);
    if (typeof idx === 'number') return idx;
  }
  const id = String(win?.dataset?.window || '').trim();
  const idx = WINDOW_ORDER_INDEX.get(`window:${id}`);
  if (typeof idx === 'number') return idx;
  return 999;
}

function openTargetWindow(targetWindow) {
  const target = String(targetWindow || '').trim();
  if (!target) return false;

  const focused = windowManager?.focusWindowById?.(target);
  if (focused) return true;

  // If this "window id" is actually a kind (e.g. "book"), ask the kind manager to open it.
  if (WINDOW_SPEC_BY_KIND.has(target)) {
    try {
      document.dispatchEvent(new CustomEvent('tt:open-kind', { detail: { kind: target } }));
      return true;
    } catch {
      return false;
    }
  }

  return false;
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
  const res = await fetch('/api/tools/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      name: 'gdelt_news',
      params: { query: String(q || '').trim(), limit: Number(limit || 30) }
    })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'news error');
  const items = data?.result?.items;
  return Array.isArray(items) ? items : [];
}

async function fetchPolymarketFeed(q, category, limit) {
  const url = new URL('/api/polymarket/feed', window.location.origin);
  if (q && String(q).trim()) url.searchParams.set('q', String(q).trim());
  if (category && String(category).trim()) url.searchParams.set('category', String(category).trim());
  url.searchParams.set('limit', String(limit || 120));

  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'polymarket feed error');
  return data;
}

async function fetchConvictions(limit, status) {
  const url = new URL('/api/convictions', window.location.origin);
  url.searchParams.set('limit', String(limit || 200));
  if (status) url.searchParams.set('status', String(status));

  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'convictions error');
  return Array.isArray(data.convictions) ? data.convictions : [];
}

async function upsertConviction(payload) {
  const res = await fetch('/api/convictions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'upsert conviction error');
  return data;
}

async function deleteConvictionById(id) {
  const res = await fetch(`/api/convictions/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json().catch(() => ({ ok: false }));
  if (!data?.ok) throw new Error(data?.error || 'delete conviction error');
  return true;
}

async function fetchEvents(limit, marketId) {
  const url = new URL('/api/events', window.location.origin);
  url.searchParams.set('limit', String(limit || 500));
  if (marketId) url.searchParams.set('marketId', String(marketId));

  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'events error');
  return Array.isArray(data.events) ? data.events : [];
}

async function createEvent(payload) {
  const res = await fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'create event error');
  return data.event;
}

async function deleteEventById(id) {
  const res = await fetch(`/api/events/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json().catch(() => ({ ok: false }));
  if (!data?.ok) throw new Error(data?.error || 'delete event error');
  return true;
}

async function fetchPositions(limit) {
  const url = new URL('/api/positions', window.location.origin);
  url.searchParams.set('limit', String(limit || 500));

  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'positions error');
  return data;
}

async function createPosition(payload) {
  const res = await fetch('/api/positions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'create position error');
  return data;
}

async function deletePositionById(id) {
  const res = await fetch(`/api/positions/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json().catch(() => ({ ok: false }));
  if (!data?.ok) throw new Error(data?.error || 'delete position error');
  return true;
}

async function fetchRules(limit) {
  const url = new URL('/api/rules', window.location.origin);
  url.searchParams.set('limit', String(limit || 500));
  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'rules error');
  return Array.isArray(data.rules) ? data.rules : [];
}

async function createRule(payload) {
  const res = await fetch('/api/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'create rule error');
  return data.rule;
}

async function updateRuleById(id, payload) {
  const res = await fetch(`/api/rules/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'update rule error');
  return data.rule;
}

async function deleteRuleById(id) {
  const res = await fetch(`/api/rules/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json().catch(() => ({ ok: false }));
  if (!data?.ok) throw new Error(data?.error || 'delete rule error');
  return true;
}

async function fetchAlerts(limit) {
  const url = new URL('/api/alerts', window.location.origin);
  url.searchParams.set('unseen', '1');
  url.searchParams.set('limit', String(limit || 50));
  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'alerts error');
  return Array.isArray(data.alerts) ? data.alerts : [];
}

async function markAlertsSeen(ids) {
  const res = await fetch('/api/alerts/seen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json().catch(() => ({ ok: false }));
  if (!data?.ok) throw new Error(data?.error || 'mark seen error');
  return true;
}

async function fetchExecutionState() {
  const url = new URL('/api/execution/state', window.location.origin);
  url.searchParams.set('limitOrders', '120');
  url.searchParams.set('limitFills', '120');
  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'execution state error');
  return data;
}

async function placeExecutionOrder(payload) {
  const res = await fetch('/api/execution/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'place order error');
  return data.order;
}

async function fillExecutionOrder(payload) {
  const res = await fetch('/api/execution/fill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'fill error');
  return data;
}

async function cancelExecutionOrder(payload) {
  const res = await fetch('/api/execution/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'cancel error');
  return data.order;
}

async function fetchStockQuote(symbol) {
  const url = new URL('/api/stocks/quote', window.location.origin);
  url.searchParams.set('symbol', String(symbol || '').trim());
  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'quote error');
  return data.quote;
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

  for (const win of windows) {
    const id = win.dataset.window;
    if (!id) continue;
    if (win.dataset.defaultHidden == null) {
      win.dataset.defaultHidden = win.classList.contains('is-hidden') ? '1' : '0';
    }
  }

  function notifyWindowsChanged() {
    try {
      document.dispatchEvent(new CustomEvent('tt:windows-changed', { detail: { workspaceId: getWorkspaceId() } }));
    } catch {
      // ignore
    }
  }

  function setFocused(target) {
    for (const w of windows) w.classList.remove('is-focused');
    target.classList.add('is-focused');
    try {
      document.dispatchEvent(
        new CustomEvent('tt:window-focus', {
          detail: { id: target.dataset.window || '', kind: target.dataset.kind || '' }
        })
      );
    } catch {
      // ignore
    }
    try {
      localStorage.setItem(windowFocusKey(getWorkspaceId()), target.dataset.window || '');
    } catch {
      // ignore
    }
  }

  function clearFocus() {
    for (const w of windows) w.classList.remove('is-focused');
    try {
      localStorage.setItem(windowFocusKey(getWorkspaceId()), '');
    } catch {
      // ignore
    }
  }

  function focusFallback(excludeId) {
    const workspaceId = getWorkspaceId();
    const candidates = windows.filter((w) => {
      const id = w.dataset.window;
      if (!id) return false;
      if (excludeId && id === excludeId) return false;
      if (w.classList.contains('is-hidden')) return false;
      const owner = w.dataset.workspace || '';
      if (owner && owner !== workspaceId) return false;
      return true;
    });
    if (!candidates.length) {
      clearFocus();
      return;
    }
    let best = candidates[0];
    let bestZ = Number.parseInt(best.style.zIndex || '0', 10);
    for (const w of candidates) {
      const z = Number.parseInt(w.style.zIndex || '0', 10);
      if (z >= bestZ) {
        best = w;
        bestZ = z;
      }
    }
    setFocused(best);
    bringToFront(best, state);
  }

  function focusWindowById(id) {
    const win = windows.find((w) => w.dataset.window === id && (!w.dataset.workspace || w.dataset.workspace === getWorkspaceId()));
    if (!win) {
      // allow focusing by "kind" for dynamically created windows (e.g. id="book")
      const byKind = windows.find((w) => w.dataset.kind === id && (!w.dataset.workspace || w.dataset.workspace === getWorkspaceId()));
      if (!byKind) return false;
      const wasHidden = byKind.classList.contains('is-hidden');
      byKind.classList.remove('is-hidden');
      setFocused(byKind);
      bringToFront(byKind, state);
      try {
        localStorage.setItem(windowHiddenKey(getWorkspaceId(), byKind.dataset.window || ''), '0');
      } catch {
        // ignore
      }
      if (wasHidden) notifyWindowsChanged();
      return true;
    }
    const wasHidden = win.classList.contains('is-hidden');
    win.classList.remove('is-hidden');
    setFocused(win);
    bringToFront(win, state);
    try {
      localStorage.setItem(windowHiddenKey(getWorkspaceId(), id), '0');
    } catch {
      // ignore
    }
    if (wasHidden) notifyWindowsChanged();
    return true;
  }

  function applyWorkspaceToWindows(workspaceId) {
    state.z = 10;
    for (const win of windows) {
      const id = win.dataset.window;
      if (!id) continue;

      let hidden = false;
      const owner = win.dataset.workspace || '';
      if (owner && owner !== workspaceId) {
        hidden = true;
      } else {
        const fallback = readWindowGeometry(win);
        const geom = loadWindowGeometry(windowStorageKey(workspaceId, id), fallback);
        applyWindowGeometry(win, geom);

        try {
          const raw = localStorage.getItem(windowHiddenKey(workspaceId, id));
          if (raw == null) hidden = win.dataset.defaultHidden === '1';
          else hidden = raw === '1';
        } catch {
          hidden = win.dataset.defaultHidden === '1';
        }
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
    const focused = focusedId ? focusWindowById(focusedId) : false;
    if (!focused) {
      const candidates = windows
        .filter((w) => !w.classList.contains('is-hidden') && (!w.dataset.workspace || w.dataset.workspace === workspaceId))
        .map((w, idx) => ({ w, idx, order: windowOrderIndexForWindowEl(w) }))
        .sort((a, b) => a.order - b.order || a.idx - b.idx);
      const next = candidates[0]?.w;
      const nextId = next?.dataset?.window;
      if (nextId) focusWindowById(nextId);
      else focusWindowById('agent');
    }
    notifyWindowsChanged();
  }

  function attachWindowInteractions(win) {
    const id = win.dataset.window;
    if (!id) return;

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
        const wasFocused = win.classList.contains('is-focused');
        const kind = win.dataset.kind || '';
        const workspaceId = getWorkspaceId();

        if (win.dataset.workspace) {
          try {
            document.dispatchEvent(new CustomEvent('tt:window-destroy', { detail: { id, kind } }));
          } catch {
            // ignore
          }
          const idx = windows.indexOf(win);
          if (idx >= 0) windows.splice(idx, 1);
          try {
            localStorage.removeItem(windowStorageKey(workspaceId, id));
            localStorage.removeItem(windowHiddenKey(workspaceId, id));
          } catch {
            // ignore
          }
          win.remove();
        } else {
          win.classList.add('is-hidden');
          try {
            localStorage.setItem(windowHiddenKey(workspaceId, id), '1');
          } catch {
            // ignore
          }
        }

        if (wasFocused) focusFallback(id);
        renderWindowsMenu();
        notifyWindowsChanged();
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

    const resizeTl = win.querySelector('[data-resize-handle-tl]');
    if (resizeTl) {
      resizeTl.addEventListener('pointerdown', (e) => {
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
        const startLeft = rect.left - desktopRect.left;
        const startTop = rect.top - desktopRect.top;
        const right = startLeft + startW;
        const bottom = startTop + startH;

        const maxLeft = Math.max(0, right - MIN_W);
        const maxTop = Math.max(0, bottom - MIN_H);

        const onMove = (ev) => {
          const nextLeft = clamp(startLeft + (ev.clientX - startX), 0, maxLeft);
          const nextTop = clamp(startTop + (ev.clientY - startY), 0, maxTop);
          const nextW = clamp(right - nextLeft, MIN_W, right);
          const nextH = clamp(bottom - nextTop, MIN_H, bottom);
          win.style.left = `${nextLeft}px`;
          win.style.top = `${nextTop}px`;
          win.style.width = `${nextW}px`;
          win.style.height = `${nextH}px`;
        };

        const onUp = () => {
          win.removeEventListener('pointermove', onMove);
          win.removeEventListener('pointerup', onUp);
          win.removeEventListener('pointercancel', onUp);

          const x = Number.parseFloat(win.style.left || String(startLeft));
          const y = Number.parseFloat(win.style.top || String(startTop));
          const w = Number.parseFloat(win.style.width || String(startW));
          const h = Number.parseFloat(win.style.height || String(startH));
          saveWindowGeometry(windowStorageKey(getWorkspaceId(), id), { x, y, w, h });
        };

        win.addEventListener('pointermove', onMove);
        win.addEventListener('pointerup', onUp);
        win.addEventListener('pointercancel', onUp);
      });
    }

    const resizeTr = win.querySelector('[data-resize-handle-tr]');
    if (resizeTr) {
      resizeTr.addEventListener('pointerdown', (e) => {
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
        const startLeft = rect.left - desktopRect.left;
        const startTop = rect.top - desktopRect.top;
        const bottom = startTop + startH;

        const maxW = desktopRect.width - startLeft;
        const maxTop = Math.max(0, bottom - MIN_H);

        const onMove = (ev) => {
          const nextW = clamp(startW + (ev.clientX - startX), MIN_W, Math.max(MIN_W, maxW));
          const nextTop = clamp(startTop + (ev.clientY - startY), 0, maxTop);
          const nextH = clamp(bottom - nextTop, MIN_H, bottom);
          win.style.top = `${nextTop}px`;
          win.style.width = `${nextW}px`;
          win.style.height = `${nextH}px`;
        };

        const onUp = () => {
          win.removeEventListener('pointermove', onMove);
          win.removeEventListener('pointerup', onUp);
          win.removeEventListener('pointercancel', onUp);

          const x = Number.parseFloat(win.style.left || String(startLeft));
          const y = Number.parseFloat(win.style.top || String(startTop));
          const w = Number.parseFloat(win.style.width || String(startW));
          const h = Number.parseFloat(win.style.height || String(startH));
          saveWindowGeometry(windowStorageKey(getWorkspaceId(), id), { x, y, w, h });
        };

        win.addEventListener('pointermove', onMove);
        win.addEventListener('pointerup', onUp);
        win.addEventListener('pointercancel', onUp);
      });
    }

    const resizeBl = win.querySelector('[data-resize-handle-bl]');
    if (resizeBl) {
      resizeBl.addEventListener('pointerdown', (e) => {
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
        const startLeft = rect.left - desktopRect.left;
        const startTop = rect.top - desktopRect.top;
        const right = startLeft + startW;

        const maxLeft = Math.max(0, right - MIN_W);
        const maxH = desktopRect.height - startTop;

        const onMove = (ev) => {
          const nextLeft = clamp(startLeft + (ev.clientX - startX), 0, maxLeft);
          const nextW = clamp(right - nextLeft, MIN_W, right);
          const nextH = clamp(startH + (ev.clientY - startY), MIN_H, Math.max(MIN_H, maxH));
          win.style.left = `${nextLeft}px`;
          win.style.width = `${nextW}px`;
          win.style.height = `${nextH}px`;
        };

        const onUp = () => {
          win.removeEventListener('pointermove', onMove);
          win.removeEventListener('pointerup', onUp);
          win.removeEventListener('pointercancel', onUp);

          const x = Number.parseFloat(win.style.left || String(startLeft));
          const y = Number.parseFloat(win.style.top || String(startTop));
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

  for (const win of windows) {
    if (!win.dataset.window) continue;
    attachWindowInteractions(win);
  }

  function registerWindow(win) {
    const id = win.dataset.window;
    if (!id) return;
    if (win.dataset.defaultHidden == null) {
      win.dataset.defaultHidden = win.classList.contains('is-hidden') ? '1' : '0';
    }
    windows.push(win);
    attachWindowInteractions(win);
    renderWindowsMenu();
    notifyWindowsChanged();
  }

  function renderWindowsMenu() {
    const list = $('windows-list');
    if (!list) return;
    list.innerHTML = '';
    for (const spec of WINDOW_SPECS) {
      const row = document.createElement('div');
      row.className = 'menu-item';

      const name = document.createElement('div');
      name.className = 'menu-item-title';
      name.textContent = spec.title;

      const btn = document.createElement('button');
      btn.className = 'menu-item-btn';
      btn.type = 'button';
      btn.textContent = 'Launch';
      btn.addEventListener('click', () => {
        if (spec.type === 'kind') {
          document.dispatchEvent(new CustomEvent('tt:open-kind', { detail: { kind: spec.kind, new: true } }));
        } else {
          focusWindowById(spec.id);
        }
        setWindowsMenuOpen(false);
        notifyWindowsChanged();
      });

      row.appendChild(name);
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  renderWindowsMenu();

  const winBtn = $('windows-btn');
  const winClose = $('windows-close');
  if (winBtn) {
    winBtn.addEventListener('click', () => {
      const menu = $('windows-menu');
      const open = menu && menu.classList.contains('is-open');
      renderWindowsMenu();
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

  return { renderWindowsMenu, focusWindowById, applyWorkspaceToWindows, registerWindow };
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
  const chipsEl = $('working-windows');
  const desktop = $('desktop');
  if (!chipsEl || !desktop) return;

  function getWorkspaceId() {
    try {
      return workspaceManager ? workspaceManager.getCurrentId() : 'default';
    } catch {
      return 'default';
    }
  }

  function setActive(id) {
    for (const chip of Array.from(chipsEl.querySelectorAll('.chip'))) {
      chip.classList.toggle('is-active', chip.dataset.window === id);
    }
  }

  function render() {
    const workspaceId = getWorkspaceId();
    const open = Array.from(desktop.querySelectorAll('.window'))
      .filter((w) => !w.classList.contains('is-hidden') && (!w.dataset.workspace || w.dataset.workspace === workspaceId))
      .map((w, idx) => ({ w, idx, order: windowOrderIndexForWindowEl(w) }))
      .sort((a, b) => a.order - b.order || a.idx - b.idx)
      .map((x) => x.w);

    chipsEl.innerHTML = '';

    const counts = new Map();
    for (const win of open) {
      const id = win.dataset.window || '';
      if (!id) continue;
      const base = chipBaseLabelForWindowEl(win);
      const n = (counts.get(base) || 0) + 1;
      counts.set(base, n);
      const label = n === 1 ? base : `${base}${n}`;

      const chip = document.createElement('button');
      chip.className = `chip${win.classList.contains('is-focused') ? ' is-active' : ''}`;
      chip.type = 'button';
      chip.dataset.window = id;
      chip.textContent = label;
      chip.title = win.dataset.title || label;
      chip.addEventListener('click', () => {
        windowManager?.focusWindowById?.(id);
        setActive(id);
      });
      chipsEl.appendChild(chip);
    }

    const focused = document.querySelector('.window.is-focused')?.dataset?.window || '';
    if (focused) setActive(focused);
  }

  document.addEventListener('tt:windows-changed', () => render());
  document.addEventListener('tt:window-focus', (e) => {
    const id = e?.detail?.id || '';
    if (id) setActive(id);
  });

  render();
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
  row.dataset.raw = String(text ?? '');

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
    openTargetWindow(item.dataset.targetWindow);
  });

  intelEl.prepend(item);

  try {
    document.dispatchEvent(new CustomEvent('tt:tool-event', { detail: event }));
  } catch {
    // ignore
  }
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
  if (!chatEl || !pinEl) return;

  function clearChatMessages() {
    const keep = [pinEl];
    chatEl.innerHTML = '';
    for (const n of keep) chatEl.appendChild(n);
    setPinnedUserPrompt('');
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

  let raf = 0;
  function updatePinnedFromScroll() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const messages = Array.from(chatEl.querySelectorAll('.chat-msg'));
      if (messages.length === 0) {
        setPinnedUserPrompt('');
        return;
      }

      const chatRect = chatEl.getBoundingClientRect();
      const pinHeight = pinEl.offsetHeight || 0;
      const cutoff = chatRect.top + pinHeight + 2;

      // Find the first message whose bottom is below the cutoff.
      let topIndex = -1;
      for (let i = 0; i < messages.length; i++) {
        const r = messages[i].getBoundingClientRect();
        if (r.bottom > cutoff) {
          topIndex = i;
          break;
        }
      }
      if (topIndex === -1) topIndex = messages.length - 1;

      // Find the nearest user message at or before topIndex.
      let pinned = '';
      for (let i = topIndex; i >= 0; i--) {
        if (messages[i].classList.contains('chat-user')) {
          pinned = messages[i].dataset.raw || '';
          break;
        }
      }

      setPinnedUserPrompt(pinned);
    });
  }

  function loadWorkspace(workspaceId) {
    clearChatMessages();
    appendChatMessage('assistant', `Workspace: ${workspaceId}`);
    appendChatMessage('assistant', 'Ask normally; the agent can call tools. Use /exec for manual runs (e.g. "/exec grok <query>").');
    updatePinnedFromScroll();
  }

  loadWorkspace(getWorkspaceId());

  chatEl.addEventListener('scroll', updatePinnedFromScroll);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = '';

    appendChatMessage('user', message);
    updatePinnedFromScroll();

    try {
      const resp = await chat(getChatSessionId(getWorkspaceId()), message);
      if (resp?.assistant) appendChatMessage('assistant', resp.assistant);
      for (const ev of resp?.events || []) appendIntelEvent(ev);
      if (resp?.events?.length && windowManager?.focusWindowById) {
        const first = resp.events[0];
        const target = first?.targetWindow || 'intel';
        openTargetWindow(target);
      }
      updatePinnedFromScroll();
    } catch (err) {
      appendChatMessage('assistant', `Error: ${err instanceof Error ? err.message : String(err)}`);
      updatePinnedFromScroll();
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

function formatTimeMs(ms) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.valueOf())) return '--:--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatCompactNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  const abs = Math.abs(num);
  if (abs >= 1e12) return `${(num / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return String(num.toFixed(0));
}

function setupDescription(getWorkspaceId) {
  const form = $('des-form');
  const symbolInput = $('des-symbol');
  const tfSel = $('des-tf');
  const status = $('des-status');
  const tv = $('des-tv');
  const symbolPill = $('des-symbol-pill');
  const exchPill = $('des-exchange-pill');

  const nameEl = $('des-name');
  const priceEl = $('des-price');
  const changeEl = $('des-change');
  const exchEl = $('des-exchange');
  const currEl = $('des-currency');
  const mcapEl = $('des-mcap');

  if (
    !form ||
    !symbolInput ||
    !tfSel ||
    !status ||
    !tv ||
    !symbolPill ||
    !exchPill ||
    !nameEl ||
    !priceEl ||
    !changeEl ||
    !exchEl ||
    !currEl ||
    !mcapEl
  ) {
    return;
  }

  let symbol = 'AAPL';
  let tvInterval = '1';
  let pollTimer = null;
  let lastQuote = null;

  function setStatus(text, isErr) {
    status.textContent = text;
    status.style.borderColor = isErr ? 'rgba(255, 92, 102, 0.7)' : 'rgba(58, 65, 71, 1)';
    status.style.color = isErr ? 'var(--danger)' : 'var(--text)';
  }

  function toTradingViewSymbol(q) {
    const raw = String(q?.exchange || '').toUpperCase();
    let venue = 'NASDAQ';
    if (raw.includes('NYSE')) venue = 'NYSE';
    else if (raw.includes('AMEX') || raw.includes('NYSEAMERICAN') || raw.includes('NYSE ARCA')) venue = 'AMEX';
    else if (raw.includes('NASDAQ')) venue = 'NASDAQ';

    const s = String(q?.symbol || symbol).trim().toUpperCase();
    if (!s) return `${venue}:${symbol}`;
    if (s.includes(':')) return s; // allow explicit TradingView symbols like "NASDAQ:AAPL"
    return `${venue}:${s}`;
  }

  function mountTradingView(symbolTv, interval) {
    // Re-inject the widget script; browser caches the JS.
    tv.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify(
      {
        autosize: true,
        symbol: symbolTv,
        interval,
        timezone: 'Etc/UTC',
        theme: 'dark',
        style: '1',
        locale: 'en',
        hide_side_toolbar: true,
        allow_symbol_change: true,
        save_image: false,
        calendar: false,
        support_host: 'https://www.tradingview.com'
      },
      null,
      2
    );
    tv.appendChild(script);
  }

  async function refresh() {
    try {
      setStatus('loading', false);
      const quote = await fetchStockQuote(symbol);

      // (Re)mount chart once we have the venue so "NASDAQ:AAPL" vs "NYSE:XYZ" is correct.
      const tvSymbol = toTradingViewSymbol(quote);
      if (tv.dataset.tvSymbol !== tvSymbol || tv.dataset.tvInterval !== tvInterval) {
        tv.dataset.tvSymbol = tvSymbol;
        tv.dataset.tvInterval = tvInterval;
        mountTradingView(tvSymbol, tvInterval);
      }

      symbolPill.textContent = quote.symbol || symbol;
      nameEl.textContent = quote.name || '—';
      exchEl.textContent = quote.exchange || '—';
      currEl.textContent = quote.currency || '—';
      exchPill.textContent = quote.exchange ? quote.exchange.split(' ')[0] : 'US';

      const px = Number(quote.price);
      const ch = Number(quote.change);
      const chPct = Number(quote.changePercent);
      priceEl.textContent = Number.isFinite(px) ? px.toFixed(2) : '—';
      changeEl.textContent = Number.isFinite(ch) && Number.isFinite(chPct) ? `${ch.toFixed(2)} (${chPct.toFixed(2)}%)` : '—';
      changeEl.style.color = Number.isFinite(ch) ? (ch >= 0 ? 'var(--accent-2)' : 'var(--danger)') : 'var(--text)';

      mcapEl.textContent = quote.marketCap ? `$${formatCompactNumber(quote.marketCap)}` : '—';

      lastQuote = quote;
      setStatus('ok', false);
    } catch (err) {
      lastQuote = null;
      setStatus(err instanceof Error ? err.message : String(err), true);
    }
  }

  function start() {
    if (pollTimer) clearInterval(pollTimer);
    refresh();
    pollTimer = setInterval(refresh, 15000);
  }

  function setFromUi(nextSymbol, tfValue) {
    const s = String(nextSymbol || '').trim().toUpperCase();
    symbol = s || 'AAPL';
    tvInterval = String(tfValue || '1').trim() || '1';

    try {
      localStorage.setItem(wsKey(getWorkspaceId(), 'des:symbol'), symbol);
      localStorage.setItem(wsKey(getWorkspaceId(), 'des:tf'), tvInterval);
    } catch {
      // ignore
    }

    symbolInput.value = symbol;
    tfSel.value = tvInterval;

    // Mount chart immediately using best-known venue (from last quote if present).
    const tvSymbol = toTradingViewSymbol(lastQuote || { symbol });
    mountTradingView(tvSymbol, tvInterval);
    start();
  }

  function loadWorkspace(workspaceId) {
    let s = 'AAPL';
    let tf = '1';
    try {
      s = localStorage.getItem(wsKey(workspaceId, 'des:symbol')) || s;
      tf = localStorage.getItem(wsKey(workspaceId, 'des:tf')) || tf;
    } catch {
      // ignore
    }
    setFromUi(s, tf);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    setFromUi(symbolInput.value, tfSel.value);
  });

  tfSel.addEventListener('change', () => setFromUi(symbolInput.value, tfSel.value));

  loadWorkspace(getWorkspaceId());

  return { loadWorkspace };
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

  function parseToolNewsItems(ev) {
    const outputs = Array.isArray(ev?.outputs) ? ev.outputs : [];
    const tableOut = outputs.find(
      (o) =>
        o &&
        o.kind === 'table' &&
        Array.isArray(o.columns) &&
        o.columns.includes('publishedAt') &&
        o.columns.includes('source') &&
        o.columns.includes('title') &&
        o.columns.includes('url')
    );

    const rows = Array.isArray(tableOut?.rows) ? tableOut.rows : [];
    const items = [];
    for (const r of rows) {
      if (!Array.isArray(r) || r.length < 4) continue;
      const publishedAt = String(r[0] ?? '').trim();
      const source = String(r[1] ?? '').trim();
      const title = String(r[2] ?? '').trim();
      const url = String(r[3] ?? '').trim();
      if (!url || !title) continue;
      items.push({ publishedAt, source, title, url });
    }
    return items;
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

  function start(opts) {
    if (pollTimer) clearInterval(pollTimer);
    if (opts?.immediate !== false) poll();
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

  function applyToolEvent(ev) {
    const outputs = Array.isArray(ev?.outputs) ? ev.outputs : [];
    const queryOut = outputs.find((o) => o && o.kind === 'text' && o.title === 'Query');
    const q = String(queryOut?.text || '').trim();
    const seed = parseToolNewsItems(ev);

    if (q) input.value = q;
    query = q || query;
    try {
      localStorage.setItem(wsKey(getWorkspaceId(), 'news:q'), query);
    } catch {
      // ignore
    }

    list.innerHTML = '';
    seen.clear();
    for (const item of seed) {
      if (!item?.url || seen.has(item.url)) continue;
      seen.add(item.url);
      list.appendChild(renderItem(item));
    }

    // Keep polling so the window stays "live", but avoid duplicating what we already rendered.
    start({ immediate: false });
  }

  return { loadWorkspace, applyToolEvent };
}

function setupPolymarket(getWorkspaceId) {
  const form = $('poly-form');
  const input = $('poly-input');
  const categorySel = $('poly-category');
  const list = $('poly-feed');
  const status = $('poly-status');
  const statsEl = $('poly-stats');
  if (!form || !input || !categorySel || !list || !status || !statsEl) return;

  let query = '';
  let category = '';
  const seen = new Set();
  let pollTimer = null;

  const toolBox = document.createElement('div');
  toolBox.className = 'poly-tool';
  toolBox.style.display = 'none';
  statsEl.insertAdjacentElement('afterend', toolBox);

  function shortAddr(addr) {
    const s = String(addr || '');
    if (!s) return '';
    if (s.length <= 14) return s;
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
  }

  function formatBet(item) {
    const dollars = Number.isFinite(Number(item.size)) ? Number(item.size) : 0;
    const pct = Number.isFinite(Number(item.price)) ? Number(item.price) * 100 : 0;
    return `$${dollars.toFixed(0)} @ ${pct.toFixed(1)}%`;
  }

  function renderItem(item) {
    const row = document.createElement('div');
    row.className = 'poly-item';
    row.title = `market: ${item.marketId}\nwallet: ${item.wallet}`;

    const top = document.createElement('div');
    top.className = 'poly-topline';

    const left = document.createElement('span');
    left.textContent = formatTimeMs(item.timestamp);

    const right = document.createElement('span');
    right.className = 'poly-right';
    const cat = item.category ? String(item.category) : 'uncategorized';
    right.textContent = `${cat} · ${formatBet(item)}`;

    top.appendChild(left);
    top.appendChild(right);

    const market = document.createElement('div');
    market.className = 'poly-market';
    market.textContent = item.question ? String(item.question) : String(item.marketId || '');

    const meta = document.createElement('div');
    meta.className = 'poly-meta';
    const side = String(item.side || '').toUpperCase();
    const outcome = String(item.outcome || '');
    meta.textContent = `${side} ${outcome} · ${shortAddr(item.wallet)}`;

    row.appendChild(top);
    row.appendChild(market);
    row.appendChild(meta);
    return row;
  }

  function setCategories(cats) {
    const desired = String(category || '');
    categorySel.innerHTML = '';

    const optAll = document.createElement('option');
    optAll.value = '';
    optAll.textContent = 'All';
    categorySel.appendChild(optAll);

    for (const c of cats || []) {
      const val = String(c || '').trim();
      if (!val) continue;
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      categorySel.appendChild(opt);
    }

    // restore desired selection if still valid
    const has = Array.from(categorySel.options).some((o) => o.value === desired);
    categorySel.value = has ? desired : '';
  }

  async function poll() {
    try {
      status.textContent = 'loading';
      const data = await fetchPolymarketFeed(query, category, 200);
      const items = data.items || [];
      status.textContent = `ok ${items.length}`;

      if (Array.isArray(data.categories)) setCategories(data.categories);
      if (data.stats) {
        const s = data.stats;
        if (s.mode === 'live') {
          statsEl.textContent = `live · window ${s.window}`;
        } else {
          statsEl.textContent = `db · trades ${s.trades} · wallets ${s.wallets} · markets ${s.markets} · alerts ${s.alerts}`;
        }
      }

      let added = 0;
      // `items` is newest→oldest; prepend in reverse so newest ends up on top.
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        const dedupeKey = item.id || '';
        if (!dedupeKey || seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        list.prepend(renderItem(item));
        added++;
      }

      if (added > 0) {
        while (list.childNodes.length > 200) list.removeChild(list.lastChild);
      }
    } catch (err) {
      status.textContent = 'err';
      const message = err instanceof Error ? err.message : String(err);
      const row = document.createElement('div');
      row.className = 'poly-item';
      row.textContent = `Error: ${message}`;
      list.prepend(row);
    }
  }

  function start() {
    if (pollTimer) clearInterval(pollTimer);
    poll();
    pollTimer = setInterval(poll, 5000);
  }

  function reset(nextQuery, nextCategory) {
    query = String(nextQuery || '').trim();
    category = String(nextCategory || '').trim();
    categorySel.value = category;
    try {
      localStorage.setItem(wsKey(getWorkspaceId(), 'poly:q'), query);
      localStorage.setItem(wsKey(getWorkspaceId(), 'poly:category'), category);
    } catch {
      // ignore
    }
    list.innerHTML = '';
    seen.clear();
    toolBox.style.display = 'none';
    toolBox.textContent = '';
    start();
  }

  function loadWorkspace(workspaceId) {
    let q = '';
    let c = '';
    try {
      q = localStorage.getItem(wsKey(workspaceId, 'poly:q')) || '';
      c = localStorage.getItem(wsKey(workspaceId, 'poly:category')) || '';
    } catch {
      q = '';
      c = '';
    }
    input.value = q;
    reset(q, c);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    reset(input.value, categorySel.value);
  });

  categorySel.addEventListener('change', () => reset(input.value, categorySel.value));

  loadWorkspace(getWorkspaceId());

  function applyToolEvent(ev) {
    const outputs = ev?.outputs || [];
    const title = String(ev?.title || 'tool').trim();
    const command = String(ev?.command || '').trim();
    const rendered = Array.isArray(outputs) ? renderOutputs(outputs) : JSON.stringify(outputs, null, 2);
    const header = `${title}${command ? `: ${command}` : ''}`.trim();

    toolBox.textContent = `${header}\n\n${rendered}`.trim();
    toolBox.style.display = 'block';
  }

  return { loadWorkspace, applyToolEvent };
}

function setupWatchlist(getWorkspaceId) {
  const form = $('wl-form');
  const form2 = $('wl-form2');
  const externalIdInput = $('wl-external-id');
  const myProbInput = $('wl-my-prob');
  const statusSel = $('wl-status-sel');
  const thesisInput = $('wl-entry-thesis');
  const refreshBtn = $('wl-refresh');
  const list = $('wl-list');
  const statusEl = $('wl-status');

  if (!form || !externalIdInput || !myProbInput || !statusSel || !list || !statusEl) return null;

  let lastMarkets = [];

  function fmtPct(p) {
    const n = Number(p);
    if (!Number.isFinite(n)) return '—';
    return `${(n * 100).toFixed(1)}%`;
  }

  function fmtEdge(edge) {
    if (edge == null) return '—';
    const n = Number(edge) * 100;
    const sign = n >= 0 ? '+' : '';
    return `${sign}${n.toFixed(1)} pts`;
  }

  function renderItem(item) {
    const row = document.createElement('div');
    row.className = 'wl-item';
    row.title = item?.market?.externalId ? `conditionId: ${item.market.externalId}` : '';

    const top = document.createElement('div');
    top.className = 'wl-topline';

    const left = document.createElement('span');
    left.textContent = String(item.status || 'watching');

    const right = document.createElement('span');
    right.className = 'wl-edge';
    right.textContent = fmtEdge(item.edge);

    top.appendChild(left);
    top.appendChild(right);

    const q = document.createElement('div');
    q.className = 'wl-question';
    q.textContent = String(item?.market?.question || item?.market?.externalId || '—');

    const meta = document.createElement('div');
    meta.className = 'wl-meta';
    const mp = item?.marketPrices?.mid == null ? '—' : fmtPct(item.marketPrices.mid);
    meta.textContent = `my ${fmtPct(item.myProbability)} · mkt ${mp} · events ${Number(item.eventCount || 0)}`;

    const actions = document.createElement('div');
    actions.className = 'wl-actions';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'wl-mini wl-mini-danger';
    del.textContent = 'DEL';
    del.title = 'Delete conviction';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        statusEl.textContent = 'deleting';
        await deleteConvictionById(item.id);
        statusEl.textContent = 'ok';
        await reload();
      } catch (err) {
        statusEl.textContent = 'err';
        appendTerminal(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    actions.appendChild(del);

    row.appendChild(top);
    row.appendChild(q);
    row.appendChild(meta);
    row.appendChild(actions);

    row.addEventListener('click', () => {
      if (item?.market?.externalId) externalIdInput.value = String(item.market.externalId);
      myProbInput.value = String(Math.round(Number(item.myProbability || 0) * 100));
      statusSel.value = String(item.status || 'watching');
      if (thesisInput) thesisInput.value = String(item.entryThesis || '');
      try {
        document.dispatchEvent(new CustomEvent('tt:calendar-market', { detail: { marketId: item.market.id } }));
      } catch {
        // ignore
      }
    });

    return row;
  }

  async function reload() {
    try {
      statusEl.textContent = 'loading';
      const convictions = await fetchConvictions(200);
      lastMarkets = convictions.map((c) => c.market).filter(Boolean);
      try {
        document.dispatchEvent(new CustomEvent('tt:markets', { detail: { markets: lastMarkets, workspaceId: getWorkspaceId() } }));
      } catch {
        // ignore
      }

      list.innerHTML = '';
      for (const c of convictions) {
        list.appendChild(renderItem(c));
      }
      statusEl.textContent = `ok ${convictions.length}`;
    } catch (err) {
      statusEl.textContent = 'err';
      list.innerHTML = '';
      const row = document.createElement('div');
      row.className = 'wl-item';
      row.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      list.appendChild(row);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const externalId = String(externalIdInput.value || '').trim();
    if (!externalId) return;
    const myProbability = String(myProbInput.value || '').trim();
    const status = String(statusSel.value || 'watching');
    const entryThesis = thesisInput ? String(thesisInput.value || '') : '';

    try {
      statusEl.textContent = 'saving';
      await upsertConviction({ source: 'polymarket', externalId, myProbability, status, entryThesis });
      statusEl.textContent = 'ok';
      await reload();
    } catch (err) {
      statusEl.textContent = 'err';
      appendTerminal(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  if (form2) {
    form2.addEventListener('submit', (e) => e.preventDefault());
  }
  if (refreshBtn) refreshBtn.addEventListener('click', () => reload());

  function loadWorkspace() {
    reload();
  }

  loadWorkspace();

  return { loadWorkspace, reload };
}

function setupCalendar(getWorkspaceId) {
  const form = $('cal-form');
  const form2 = $('cal-form2');
  const marketSel = $('cal-market');
  const titleInput = $('cal-title');
  const dateInput = $('cal-date');
  const confidenceSel = $('cal-confidence');
  const sourceInput = $('cal-source');
  const impactInput = $('cal-impact');
  const refreshBtn = $('cal-refresh');
  const list = $('cal-list');
  const statusEl = $('cal-status');

  if (!form || !marketSel || !titleInput || !dateInput || !confidenceSel || !list || !statusEl) return null;

  let markets = [];
  let selectedMarketId = '';

  function rebuildMarketOptions() {
    const desired = String(selectedMarketId || '');
    marketSel.innerHTML = '';

    const optGlobal = document.createElement('option');
    optGlobal.value = '';
    optGlobal.textContent = '(global)';
    marketSel.appendChild(optGlobal);

    for (const m of markets) {
      const opt = document.createElement('option');
      opt.value = String(m.id || '');
      const label = m.question ? String(m.question) : m.externalId ? String(m.externalId) : String(m.id || '');
      opt.textContent = label.slice(0, 80);
      marketSel.appendChild(opt);
    }

    const has = Array.from(marketSel.options).some((o) => o.value === desired);
    marketSel.value = has ? desired : '';
  }

  function renderEvent(ev) {
    const row = document.createElement('div');
    row.className = 'cal-item';

    const top = document.createElement('div');
    top.className = 'cal-topline';

    const left = document.createElement('span');
    left.className = 'cal-date';
    left.textContent = String(ev.date || '—');

    const right = document.createElement('span');
    right.textContent = String(ev.dateConfidence || 'unknown');

    top.appendChild(left);
    top.appendChild(right);

    const title = document.createElement('div');
    title.className = 'cal-title';
    title.textContent = String(ev.title || '—');

    const meta = document.createElement('div');
    meta.className = 'cal-meta';
    const marketName = ev.market?.question ? String(ev.market.question) : ev.market ? String(ev.market.externalId || ev.market.id) : '(global)';
    meta.textContent = marketName.slice(0, 90);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'wl-mini wl-mini-danger';
    del.textContent = 'DEL';
    del.title = 'Delete event';
    del.addEventListener('click', async () => {
      try {
        statusEl.textContent = 'deleting';
        await deleteEventById(ev.id);
        statusEl.textContent = 'ok';
        await reload();
      } catch (err) {
        statusEl.textContent = 'err';
        appendTerminal(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    row.appendChild(top);
    row.appendChild(title);
    row.appendChild(meta);
    row.appendChild(del);

    return row;
  }

  async function reload() {
    try {
      statusEl.textContent = 'loading';
      const events = await fetchEvents(500, selectedMarketId);
      list.innerHTML = '';
      for (const ev of events) list.appendChild(renderEvent(ev));
      statusEl.textContent = `ok ${events.length}`;
    } catch (err) {
      statusEl.textContent = 'err';
      list.innerHTML = '';
      const row = document.createElement('div');
      row.className = 'cal-item';
      row.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      list.appendChild(row);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const marketId = String(marketSel.value || '');
    const title = String(titleInput.value || '').trim();
    const date = String(dateInput.value || '').trim();
    const dateConfidence = String(confidenceSel.value || 'unknown');
    const source = sourceInput ? String(sourceInput.value || '').trim() : '';
    const impactHypothesis = impactInput ? String(impactInput.value || '').trim() : '';
    if (!title || !date) return;

    try {
      statusEl.textContent = 'saving';
      await createEvent({
        marketId: marketId || null,
        title,
        date,
        dateConfidence,
        source: source || null,
        impactHypothesis,
        createdBy: 'user'
      });
      titleInput.value = '';
      dateInput.value = '';
      if (sourceInput) sourceInput.value = '';
      if (impactInput) impactInput.value = '';
      statusEl.textContent = 'ok';
      await reload();
    } catch (err) {
      statusEl.textContent = 'err';
      appendTerminal(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  if (form2) form2.addEventListener('submit', (e) => e.preventDefault());
  if (refreshBtn) refreshBtn.addEventListener('click', () => reload());

  marketSel.addEventListener('change', () => {
    selectedMarketId = String(marketSel.value || '');
    try {
      localStorage.setItem(wsKey(getWorkspaceId(), 'cal:marketId'), selectedMarketId);
    } catch {
      // ignore
    }
    reload();
  });

  document.addEventListener('tt:markets', (e) => {
    const ws = e?.detail?.workspaceId;
    if (ws && ws !== getWorkspaceId()) return;
    const next = Array.isArray(e?.detail?.markets) ? e.detail.markets : [];
    markets = next;
    rebuildMarketOptions();
  });

  document.addEventListener('tt:calendar-market', (e) => {
    const marketId = String(e?.detail?.marketId || '');
    if (!marketId) return;
    selectedMarketId = marketId;
    try {
      localStorage.setItem(wsKey(getWorkspaceId(), 'cal:marketId'), selectedMarketId);
    } catch {
      // ignore
    }
    rebuildMarketOptions();
    reload();
  });

  function loadWorkspace(workspaceId) {
    try {
      selectedMarketId = localStorage.getItem(wsKey(workspaceId, 'cal:marketId')) || '';
    } catch {
      selectedMarketId = '';
    }
    rebuildMarketOptions();
    reload();
  }

  loadWorkspace(getWorkspaceId());

  return { loadWorkspace, reload };
}

function setupPortfolio(getWorkspaceId) {
  const form = $('pf-form');
  const marketSel = $('pf-market');
  const outcomeSel = $('pf-outcome');
  const sharesInput = $('pf-shares');
  const avgInput = $('pf-avg');
  const refreshBtn = $('pf-refresh');
  const totalsEl = $('pf-totals');
  const list = $('pf-list');
  const statusEl = $('pf-status');

  if (!form || !marketSel || !outcomeSel || !sharesInput || !avgInput || !refreshBtn || !totalsEl || !list || !statusEl) return null;

  let markets = [];

  function rebuildMarketOptions(selectedExternalId) {
    const desired = String(selectedExternalId || '');
    marketSel.innerHTML = '';

    const optEmpty = document.createElement('option');
    optEmpty.value = '';
    optEmpty.textContent = 'Select market';
    marketSel.appendChild(optEmpty);

    for (const m of markets || []) {
      const externalId = String(m?.externalId || '').trim();
      if (!externalId) continue;
      const label = m?.question ? String(m.question) : externalId;
      const opt = document.createElement('option');
      opt.value = externalId;
      opt.textContent = label.slice(0, 120);
      marketSel.appendChild(opt);
    }

    const has = Array.from(marketSel.options).some((o) => o.value === desired);
    marketSel.value = has ? desired : '';
  }

  function fmtUsd(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    const sign = x >= 0 ? '+' : '';
    return `${sign}$${x.toFixed(2)}`;
  }

  function fmtNum(n, d) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return x.toFixed(d ?? 2);
  }

  function fmtPct(p) {
    const x = Number(p);
    if (!Number.isFinite(x)) return '—';
    return `${(x * 100).toFixed(1)}%`;
  }

  function renderItem(pos) {
    const row = document.createElement('div');
    row.className = 'pf-item';

    const top = document.createElement('div');
    top.className = 'pf-topline';

    const left = document.createElement('span');
    left.textContent = `${String(pos.outcome || 'YES')} · ${fmtNum(pos.shares, 2)} sh`;

    const right = document.createElement('span');
    right.className = 'pf-right';
    right.textContent = pos.pnl == null ? 'pnl —' : `pnl ${fmtUsd(pos.pnl)}`;

    top.appendChild(left);
    top.appendChild(right);

    const market = document.createElement('div');
    market.className = 'pf-market';
    market.textContent = String(pos?.market?.question || pos?.market?.externalId || '—');

    const meta = document.createElement('div');
    meta.className = 'pf-meta';
    const avg = pos.avgPrice == null ? '—' : fmtPct(pos.avgPrice);
    const cur = pos.currentPrice == null ? '—' : fmtPct(pos.currentPrice);
    meta.textContent = `avg ${avg} · cur ${cur} · cost ${fmtUsd(pos.cost)} · val ${pos.value == null ? '—' : fmtUsd(pos.value)}`;

    const actions = document.createElement('div');
    actions.className = 'pf-actions';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'wl-mini wl-mini-danger';
    del.textContent = 'DEL';
    del.title = 'Delete position';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        statusEl.textContent = 'deleting';
        await deletePositionById(pos.id);
        statusEl.textContent = 'ok';
        await reload();
      } catch (err) {
        statusEl.textContent = 'err';
        appendTerminal(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    actions.appendChild(del);

    row.appendChild(top);
    row.appendChild(market);
    row.appendChild(meta);
    row.appendChild(actions);

    row.addEventListener('click', () => {
      try {
        const marketId = String(pos?.market?.id || '');
        if (marketId) document.dispatchEvent(new CustomEvent('tt:calendar-market', { detail: { marketId } }));
      } catch {
        // ignore
      }
    });

    return row;
  }

  async function reload() {
    try {
      statusEl.textContent = 'loading';
      const data = await fetchPositions(500);
      const positions = Array.isArray(data?.positions) ? data.positions : [];
      const totals = data?.totals || {};

      totalsEl.textContent = `cost ${fmtUsd(totals.cost)} · value ${fmtUsd(totals.value)} · pnl ${fmtUsd(totals.pnl)}`;

      list.innerHTML = '';
      for (const p of positions) list.appendChild(renderItem(p));
      statusEl.textContent = `ok ${positions.length}`;
    } catch (err) {
      statusEl.textContent = 'err';
      totalsEl.textContent = '—';
      list.innerHTML = '';
      const row = document.createElement('div');
      row.className = 'pf-item';
      row.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      list.appendChild(row);
    }
  }

  refreshBtn.addEventListener('click', () => reload());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const externalId = String(marketSel.value || '').trim();
    if (!externalId) return;
    const outcome = String(outcomeSel.value || 'YES').toUpperCase() === 'NO' ? 'NO' : 'YES';
    const shares = String(sharesInput.value || '').trim();
    const avgPrice = String(avgInput.value || '').trim();
    if (!shares || !avgPrice) return;

    try {
      statusEl.textContent = 'saving';
      await createPosition({ source: 'polymarket', externalId, outcome, shares, avgPrice });
      statusEl.textContent = 'ok';
      sharesInput.value = '';
      avgInput.value = '';
      await reload();
    } catch (err) {
      statusEl.textContent = 'err';
      appendTerminal(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  document.addEventListener('tt:markets', (e) => {
    const ws = e?.detail?.workspaceId;
    if (ws && ws !== getWorkspaceId()) return;
    markets = Array.isArray(e?.detail?.markets) ? e.detail.markets : [];
    rebuildMarketOptions(marketSel.value);
  });

  function loadWorkspace(workspaceId) {
    let selected = '';
    try {
      selected = localStorage.getItem(wsKey(workspaceId, 'pf:externalId')) || '';
    } catch {
      selected = '';
    }
    rebuildMarketOptions(selected);
    reload();
  }

  marketSel.addEventListener('change', () => {
    try {
      localStorage.setItem(wsKey(getWorkspaceId(), 'pf:externalId'), String(marketSel.value || ''));
    } catch {
      // ignore
    }
  });

  loadWorkspace(getWorkspaceId());

  return { loadWorkspace, reload };
}

function setupRules(getWorkspaceId) {
  const form = $('rules-form');
  const marketSel = $('rules-market');
  const typeSel = $('rules-type');
  const thresholdInput = $('rules-threshold');
  const minMyInput = $('rules-min-my');
  const refreshBtn = $('rules-refresh');
  const list = $('rules-list');
  const statusEl = $('rules-status');

  if (!form || !marketSel || !typeSel || !thresholdInput || !minMyInput || !refreshBtn || !list || !statusEl) return null;

  let markets = [];

  function rebuildMarketOptions(selectedMarketId) {
    const desired = String(selectedMarketId || '');
    marketSel.innerHTML = '';

    const optEmpty = document.createElement('option');
    optEmpty.value = '';
    optEmpty.textContent = 'Select market';
    marketSel.appendChild(optEmpty);

    for (const m of markets || []) {
      const id = String(m?.id || '').trim();
      if (!id) continue;
      const label = m?.question ? String(m.question) : m?.externalId ? String(m.externalId) : id;
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = label.slice(0, 120);
      marketSel.appendChild(opt);
    }

    const has = Array.from(marketSel.options).some((o) => o.value === desired);
    marketSel.value = has ? desired : '';
  }

  function fmtPct(p) {
    const x = Number(p);
    if (!Number.isFinite(x)) return '—';
    return `${(x * 100).toFixed(1)}%`;
  }

  function renderRule(rule) {
    const row = document.createElement('div');
    row.className = 'rules-item';

    const top = document.createElement('div');
    top.className = 'rules-topline';

    const left = document.createElement('span');
    left.textContent = String(rule.status || 'active');

    const right = document.createElement('span');
    right.className = 'rules-right';
    right.textContent = `${rule.type === 'price_above' ? '≥' : '≤'} ${fmtPct(rule.priceThreshold)}`;

    top.appendChild(left);
    top.appendChild(right);

    const market = document.createElement('div');
    market.className = 'rules-market';
    market.textContent = String(rule?.market?.question || rule?.market?.externalId || rule.marketId || '—');

    const meta = document.createElement('div');
    meta.className = 'rules-meta';
    meta.textContent = rule.minMyProbability != null ? `min my ${fmtPct(rule.minMyProbability)}` : 'min my —';

    const actions = document.createElement('div');
    actions.className = 'rules-actions';

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'wl-mini wl-mini-danger';
    del.textContent = 'DEL';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        statusEl.textContent = 'deleting';
        await deleteRuleById(rule.id);
        statusEl.textContent = 'ok';
        await reload();
      } catch (err) {
        statusEl.textContent = 'err';
        appendTerminal(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    const act = document.createElement('button');
    act.type = 'button';
    act.className = 'wl-mini';
    act.textContent = 'ACT';
    act.title = 'Set active';
    act.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        statusEl.textContent = 'updating';
        await updateRuleById(rule.id, { status: 'active' });
        statusEl.textContent = 'ok';
        await reload();
      } catch (err) {
        statusEl.textContent = 'err';
        appendTerminal(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    const dis = document.createElement('button');
    dis.type = 'button';
    dis.className = 'wl-mini';
    dis.textContent = 'DIS';
    dis.title = 'Disable';
    dis.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        statusEl.textContent = 'updating';
        await updateRuleById(rule.id, { status: 'disabled' });
        statusEl.textContent = 'ok';
        await reload();
      } catch (err) {
        statusEl.textContent = 'err';
        appendTerminal(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    actions.appendChild(act);
    actions.appendChild(dis);
    actions.appendChild(del);

    row.appendChild(top);
    row.appendChild(market);
    row.appendChild(meta);
    row.appendChild(actions);

    row.addEventListener('click', () => {
      try {
        const marketId = String(rule.marketId || '');
        if (marketId) document.dispatchEvent(new CustomEvent('tt:calendar-market', { detail: { marketId } }));
      } catch {
        // ignore
      }
    });

    return row;
  }

  async function reload() {
    try {
      statusEl.textContent = 'loading';
      const rules = await fetchRules(500);
      list.innerHTML = '';
      for (const r of rules) list.appendChild(renderRule(r));
      statusEl.textContent = `ok ${rules.length}`;
    } catch (err) {
      statusEl.textContent = 'err';
      list.innerHTML = '';
      const row = document.createElement('div');
      row.className = 'rules-item';
      row.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      list.appendChild(row);
    }
  }

  refreshBtn.addEventListener('click', () => reload());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const marketId = String(marketSel.value || '').trim();
    if (!marketId) return;
    const type = String(typeSel.value || 'price_below');
    const priceThreshold = String(thresholdInput.value || '').trim();
    if (!priceThreshold) return;
    const minMyProbability = String(minMyInput.value || '').trim();

    try {
      statusEl.textContent = 'saving';
      await createRule({
        marketId,
        type,
        priceThreshold,
        minMyProbability: minMyProbability ? minMyProbability : null
      });
      statusEl.textContent = 'ok';
      thresholdInput.value = '';
      minMyInput.value = '';
      await reload();
    } catch (err) {
      statusEl.textContent = 'err';
      appendTerminal(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  document.addEventListener('tt:markets', (e) => {
    const ws = e?.detail?.workspaceId;
    if (ws && ws !== getWorkspaceId()) return;
    markets = Array.isArray(e?.detail?.markets) ? e.detail.markets : [];
    rebuildMarketOptions(marketSel.value);
  });

  function loadWorkspace(workspaceId) {
    let selected = '';
    try {
      selected = localStorage.getItem(wsKey(workspaceId, 'rules:marketId')) || '';
    } catch {
      selected = '';
    }
    rebuildMarketOptions(selected);
    reload();
  }

  marketSel.addEventListener('change', () => {
    try {
      localStorage.setItem(wsKey(getWorkspaceId(), 'rules:marketId'), String(marketSel.value || ''));
    } catch {
      // ignore
    }
  });

  loadWorkspace(getWorkspaceId());

  return { loadWorkspace, reload };
}

function setupAlerts(getWorkspaceId) {
  const intelEl = $('intel');
  if (!intelEl) return null;

  const seen = new Set();

  function appendAlert(alert) {
    if (!alert || !alert.id) return;
    if (seen.has(alert.id)) return;
    seen.add(alert.id);

    const item = document.createElement('div');
    item.className = 'intel-item';
    item.dataset.targetWindow = 'watchlist';

    const title = document.createElement('div');
    title.className = 'intel-title';
    const ts = alert.createdAt ? new Date(alert.createdAt).toLocaleTimeString() : '';
    title.textContent = `ALERT ${ts}`.trim();

    const body = document.createElement('div');
    body.className = 'intel-body';
    body.textContent = String(alert.message || '').trim();

    item.appendChild(title);
    item.appendChild(body);
    item.addEventListener('click', () => {
      if (windowManager?.focusWindowById) windowManager.focusWindowById('watchlist');
      try {
        const marketId = String(alert?.market?.id || alert?.marketId || '');
        if (marketId) document.dispatchEvent(new CustomEvent('tt:calendar-market', { detail: { marketId } }));
      } catch {
        // ignore
      }
    });

    intelEl.prepend(item);
  }

  async function poll() {
    try {
      const alerts = await fetchAlerts(50);
      if (!alerts.length) return;
      // oldest -> newest so newest ends up on top
      const ids = [];
      for (let i = alerts.length - 1; i >= 0; i--) {
        const a = alerts[i];
        appendAlert(a);
        if (a?.id) ids.push(a.id);
      }
      if (ids.length) await markAlertsSeen(ids);
    } catch {
      // ignore
    }
  }

  // tiny delay so the server is fully up in dev
  setTimeout(poll, 500);
  const timer = setInterval(poll, 3000);

  return { stop: () => clearInterval(timer) };
}

async function fetchBinanceSymbols() {
  const url = new URL('/api/orderbook/binance/symbols', window.location.origin);
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'binance symbols error');
  return Array.isArray(data.symbols) ? data.symbols : [];
}

async function fetchPolymarketClobBook(conditionId, outcome, depth) {
  const url = new URL('/api/orderbook/polymarket/book', window.location.origin);
  url.searchParams.set('conditionId', String(conditionId || '').trim());
  url.searchParams.set('outcome', String(outcome || 'YES').trim().toUpperCase());
  url.searchParams.set('depth', String(depth || 20));
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${t ? `: ${t}` : ''}`);
  }
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || 'polymarket book error');
  return data;
}

function computeTotals(levels, isBids) {
  const out = [];
  let cum = 0;
  for (const lvl of levels) {
    cum += lvl.size;
    out.push({ price: lvl.price, size: lvl.size, total: cum });
  }
  // bids are best->worst already for our purposes
  return out;
}

function makeOrderBook(symbol, source, bids, asks, lastUpdate) {
  const bestBid = bids.length ? bids[0].price : null;
  const bestAsk = asks.length ? asks[0].price : null;
  const midPrice = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk ?? 0;
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : 0;
  const spreadPercent = midPrice ? (spread / midPrice) * 100 : 0;
  return { symbol, source, bids, asks, spread, spreadPercent, midPrice, lastUpdate };
}

function setupOrderBookManager(getWorkspaceId) {
  const desktop = $('desktop');
  const tpl = document.getElementById('tpl-window-book');
  if (!desktop || !tpl) return null;

  const sources = [
    { name: 'binance', label: 'binance' },
    { name: 'polymarket', label: 'polymarket' },
    { name: 'mock', label: 'mock' }
  ];

  const controllers = new Map(); // windowId -> controller
  let cachedBinanceSymbols = null;
  let fetchingSymbols = null;
  let cachedPolymarketMarkets = [];

  document.addEventListener('tt:markets', (e) => {
    const ws = e?.detail?.workspaceId;
    if (ws && ws !== getWorkspaceId()) return;
    const next = Array.isArray(e?.detail?.markets) ? e.detail.markets : [];
    cachedPolymarketMarkets = next;
  });

  function toBinancePair(symbol) {
    const s = String(symbol || '').trim().toUpperCase();
    const parts = s.split('/');
    if (parts.length !== 2) return s.replaceAll('/', '').toLowerCase();
    return `${parts[0]}${parts[1]}`.toLowerCase();
  }

  function setWindowTitle(winEl, symbol, source) {
    const base = String(symbol || '').trim() || '—';
    winEl.dataset.title = `Order Book (${base} · ${source})`;
    const titleEl = winEl.querySelector('.window-title');
    if (titleEl) titleEl.textContent = 'Order Book';
    windowManager?.renderWindowsMenu?.(Array.from(document.querySelectorAll('.window')));
  }

  function buildBookFromBinanceMsg(symbol, depth, msg) {
    const bidsRaw = Array.isArray(msg?.bids) ? msg.bids : [];
    const asksRaw = Array.isArray(msg?.asks) ? msg.asks : [];

    const bids = [];
    for (const [p, q] of bidsRaw) {
      const price = Number(p);
      const size = Number(q);
      if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
      bids.push({ price, size });
    }
    bids.sort((a, b) => b.price - a.price);

    const asks = [];
    for (const [p, q] of asksRaw) {
      const price = Number(p);
      const size = Number(q);
      if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
      asks.push({ price, size });
    }
    asks.sort((a, b) => a.price - b.price);

    const clippedBids = bids.slice(0, depth);
    const clippedAsks = asks.slice(0, depth);

    return makeOrderBook(symbol, 'binance', computeTotals(clippedBids, true), computeTotals(clippedAsks, false), Date.now());
  }

  function createMockBook(symbol, depth) {
    const mid = 100 + Math.random() * 50;
    const tick = 0.5;
    const bids = [];
    const asks = [];
    for (let i = 0; i < depth; i++) {
      bids.push({ price: +(mid - tick * (i + 1)).toFixed(2), size: +(Math.random() * 2 + 0.05).toFixed(3) });
      asks.push({ price: +(mid + tick * (i + 1)).toFixed(2), size: +(Math.random() * 2 + 0.05).toFixed(3) });
    }
    return makeOrderBook(symbol, 'mock', computeTotals(bids, true), computeTotals(asks, false), Date.now());
  }

  async function ensureSymbolsLoaded(symbolSel, sourceName) {
    if (sourceName !== 'binance') {
      if (sourceName === 'polymarket') {
        // If the watchlist hasn't loaded yet, pull it once on demand.
        if (!cachedPolymarketMarkets || cachedPolymarketMarkets.length === 0) {
          try {
            const convictions = await fetchConvictions(200);
            cachedPolymarketMarkets = convictions.map((c) => c.market).filter(Boolean);
          } catch {
            cachedPolymarketMarkets = cachedPolymarketMarkets || [];
          }
        }

        symbolSel.innerHTML = '';

        const optCustom = document.createElement('option');
        optCustom.value = '__custom__';
        optCustom.textContent = 'CUSTOM…';
        symbolSel.appendChild(optCustom);

        for (const m of cachedPolymarketMarkets || []) {
          const val = String(m?.externalId || '').trim();
          if (!val) continue;
          const label = m?.question ? String(m.question) : val;
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = label.slice(0, 120);
          symbolSel.appendChild(opt);
        }

        if (symbolSel.options.length === 1) {
          const opt = document.createElement('option');
          opt.value = '0x';
          opt.textContent = 'Paste a conditionId via CUSTOM…';
          symbolSel.appendChild(opt);
        }

        return;
      }

      if (symbolSel.options.length === 0) {
        const defaults = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT'];
        for (const sym of defaults) {
          const opt = document.createElement('option');
          opt.value = sym;
          opt.textContent = sym;
          symbolSel.appendChild(opt);
        }
      }
      return;
    }
    if (cachedBinanceSymbols) return;
    if (!fetchingSymbols) fetchingSymbols = fetchBinanceSymbols().then((s) => (cachedBinanceSymbols = s)).finally(() => (fetchingSymbols = null));
    await fetchingSymbols;
    symbolSel.innerHTML = '';
    for (const sym of cachedBinanceSymbols.slice(0, 2000)) {
      const opt = document.createElement('option');
      opt.value = sym;
      opt.textContent = sym;
      symbolSel.appendChild(opt);
    }
  }

  function mountWindow(winEl, initial) {
    const symbolSel = winEl.querySelector('[data-ob-symbol]');
    const outcomeSel = winEl.querySelector('[data-ob-outcome]');
    const sourceSel = winEl.querySelector('[data-ob-source]');
    const depthSel = winEl.querySelector('[data-ob-depth]');
    const filterLabel = winEl.querySelector('[data-ob-filter-label]');
    const filterInput = winEl.querySelector('[data-ob-filter]');
    const slipLabel = winEl.querySelector('[data-ob-slip-label]');
    const slipSideSel = winEl.querySelector('[data-ob-slip-side]');
    const slipModeSel = winEl.querySelector('[data-ob-slip-mode]');
    const slipSizeInput = winEl.querySelector('[data-ob-slip-size]');
    const slipOut = winEl.querySelector('[data-ob-slip-out]');
    const infoPill = winEl.querySelector('[data-ob-info]');
    const posPill = winEl.querySelector('[data-ob-pos]');
    const asksEl = winEl.querySelector('[data-ob-asks]');
    const bidsEl = winEl.querySelector('[data-ob-bids]');
    const spreadEl = winEl.querySelector('[data-ob-spread]');
    const midEl = winEl.querySelector('[data-ob-mid]');
    const updatedEl = winEl.querySelector('[data-ob-updated]');
    const mpsEl = winEl.querySelector('[data-ob-mps]');
    const liveEl = winEl.querySelector('[data-ob-live]');
    const newBtn = winEl.querySelector('[data-ob-new]');

    if (
      !symbolSel ||
      !outcomeSel ||
      !sourceSel ||
      !depthSel ||
      !asksEl ||
      !bidsEl ||
      !spreadEl ||
      !midEl ||
      !updatedEl ||
      !mpsEl ||
      !liveEl ||
      !newBtn ||
      !filterLabel ||
      !filterInput ||
      !slipLabel ||
      !slipSideSel ||
      !slipModeSel ||
      !slipSizeInput ||
      !slipOut ||
      !infoPill ||
      !posPill
    )
      return null;

    sourceSel.innerHTML = '';
    for (const s of sources) {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.label;
      sourceSel.appendChild(opt);
    }

    let symbol = initial?.symbol || 'BTC/USDT';
    let source = initial?.source || 'binance';
    let outcome = String(initial?.outcome || 'YES').trim().toUpperCase() === 'NO' ? 'NO' : 'YES';
    let depth = Number(initial?.depth || 20);
    if (!Number.isFinite(depth) || depth <= 0) depth = 20;

    let ws = null;
    let mockTimer = null;
    let pollTimer = null;
    let lastUpdate = 0;
    let msgCount = 0;
    let msgRate = 0;
    let msgTimer = 0;
    let latestBook = null;
    let latestPolyMeta = null;

    let filterQ = '';
    let filterTimer = 0;

    function setStatus(state) {
      liveEl.classList.toggle('is-stale', state === 'stale');
      liveEl.classList.toggle('is-dead', state === 'dead');
      const text = liveEl.querySelector('[data-ob-live-text]');
      if (text) text.textContent = state === 'dead' ? 'DISC' : state === 'stale' ? 'STALE' : 'LIVE';
    }

    function teardown() {
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
      if (mockTimer) {
        clearInterval(mockTimer);
        mockTimer = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (msgTimer) {
        clearInterval(msgTimer);
        msgTimer = 0;
      }
    }

    let lastRender = 0;
    let raf = 0;
    function scheduleRender() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const now = performance.now();
        if (now - lastRender < 33) {
          scheduleRender();
          return;
        }
        lastRender = now;
        render();
      });
    }

  function renderRows(container, levels, maxTotal) {
      container.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (const lvl of levels) {
        const row = document.createElement('div');
        row.className = 'ob-row';
        row.title = `price ${lvl.price}\nsize ${lvl.size}\ntotal ${lvl.total}\n${maxTotal ? ((lvl.total / maxTotal) * 100).toFixed(1) : '0'}% depth`;

        const depthCell = document.createElement('div');
        depthCell.className = 'ob-depth';
        depthCell.textContent = '';

        const bar = document.createElement('div');
        bar.className = 'ob-bar';
        bar.style.width = `${maxTotal ? (lvl.total / maxTotal) * 100 : 0}%`;
        depthCell.appendChild(bar);

        const price = document.createElement('div');
        price.className = 'ob-price ob-num';
        price.textContent = lvl.price.toLocaleString(undefined, { maximumFractionDigits: 8 });

        const size = document.createElement('div');
        size.className = 'ob-num';
        size.textContent = lvl.size.toLocaleString(undefined, { maximumFractionDigits: 8 });

        const total = document.createElement('div');
        total.className = 'ob-num';
        total.textContent = lvl.total.toLocaleString(undefined, { maximumFractionDigits: 8 });

        // overwrite layout (bar is absolute)
        row.replaceChildren(depthCell, price, size, total);

        row.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(String(lvl.price));
          } catch {
            // ignore
          }
        });

        frag.appendChild(row);
      }
      container.appendChild(frag);
    }

    function render() {
      if (!latestBook) return;
      const b = latestBook;
      const maxBid = b.bids.length ? b.bids[b.bids.length - 1].total : 0;
      const maxAsk = b.asks.length ? b.asks[b.asks.length - 1].total : 0;
      const maxTotal = Math.max(maxBid, maxAsk, 1e-9);

      renderRows(asksEl, b.asks, maxTotal);
      renderRows(bidsEl, b.bids, maxTotal);

      spreadEl.textContent = `SPREAD: ${b.spread.toFixed(4)} (${b.spreadPercent.toFixed(3)}%)`;
      midEl.textContent = `MID: ${b.midPrice.toFixed(4)}`;

      const ageMs = Date.now() - b.lastUpdate;
      updatedEl.textContent = `updated: ${(ageMs / 1000).toFixed(1)}s ago`;
      mpsEl.textContent = `msgs/s: ${msgRate}`;

      if (ageMs > 8000) setStatus('dead');
      else if (ageMs > 2000) setStatus('stale');
      else setStatus('live');

      if (source === 'polymarket' && latestPolyMeta) {
        const end = String(latestPolyMeta.endDate || '').slice(0, 10);
        const liq = Number(latestPolyMeta.liquidityNum || 0);
        const vol = Number(latestPolyMeta.volume24hrClob || latestPolyMeta.volume24hr || 0);
        infoPill.textContent = `24h $${Math.round(vol).toLocaleString()} · liq $${Math.round(liq).toLocaleString()} · exp ${end || '—'}`;

        const yes = latestPolyMeta.position?.YES;
        const no = latestPolyMeta.position?.NO;
        const yesStr = yes?.shares ? `YES ${yes.shares.toFixed(0)} @ ${(Number(yes.avgPrice || 0) * 100).toFixed(1)}%` : 'YES —';
        const noStr = no?.shares ? `NO ${no.shares.toFixed(0)} @ ${(Number(no.avgPrice || 0) * 100).toFixed(1)}%` : 'NO —';
        const pnlYes = yes?.pnl == null ? '' : ` (pnl ${yes.pnl >= 0 ? '+' : ''}$${Number(yes.pnl).toFixed(2)})`;
        const pnlNo = no?.pnl == null ? '' : ` (pnl ${no.pnl >= 0 ? '+' : ''}$${Number(no.pnl).toFixed(2)})`;
        posPill.textContent = `${yesStr}${pnlYes} · ${noStr}${pnlNo}`;

        // slippage calculator (uses current rendered levels; best-effort)
        const slipSide = String(slipSideSel.value || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
        const slipMode = String(slipModeSel.value || 'shares').toLowerCase() === 'usd' ? 'usd' : 'shares';
        const slipSize = Number(String(slipSizeInput.value || '').trim());
        if (!Number.isFinite(slipSize) || slipSize <= 0) {
          slipOut.textContent = 'slip: —';
        } else {
          const levels = slipSide === 'BUY' ? b.asks : b.bids;
          let filledShares = 0;
          let filledUsd = 0;
          let worst = null;

          if (slipMode === 'shares') {
            let remaining = slipSize;
            for (const lvl of levels) {
              if (remaining <= 1e-9) break;
              const take = Math.min(remaining, lvl.size);
              filledShares += take;
              filledUsd += take * lvl.price;
              worst = lvl.price;
              remaining -= take;
            }
          } else {
            let remaining = slipSize;
            for (const lvl of levels) {
              if (remaining <= 1e-9) break;
              const levelUsd = lvl.size * lvl.price;
              const takeUsd = Math.min(remaining, levelUsd);
              const takeShares = lvl.price > 0 ? takeUsd / lvl.price : 0;
              filledShares += takeShares;
              filledUsd += takeUsd;
              worst = lvl.price;
              remaining -= takeUsd;
            }
          }

          const avg = filledShares > 0 ? filledUsd / filledShares : null;
          const partial = slipMode === 'shares' ? filledShares + 1e-9 < slipSize : filledUsd + 1e-9 < slipSize;
          const avgStr = avg == null ? '—' : `${(avg * 100).toFixed(2)}%`;
          const worstStr = worst == null ? '—' : `${(worst * 100).toFixed(2)}%`;
          const amtStr = slipMode === 'shares' ? `${filledShares.toFixed(0)} sh` : `$${filledUsd.toFixed(2)}`;
          slipOut.textContent = `slip: avg ${avgStr} · ${amtStr}${partial ? ' (partial)' : ''} · worst ${worstStr}`;
        }
      } else {
        infoPill.textContent = '—';
        posPill.textContent = '—';
        slipOut.textContent = 'slip: —';
      }
    }

    async function connect() {
      teardown();
      msgCount = 0;
      msgRate = 0;
      lastUpdate = 0;
      latestPolyMeta = null;

      if (source === 'binance') {
        if (![5, 10, 20].includes(depth)) depth = depth <= 5 ? 5 : depth <= 10 ? 10 : 20;
      }
      const safeDepth = source === 'binance' ? depth : depth;

      await ensureSymbolsLoaded(symbolSel, source);
      if (!Array.from(symbolSel.options).some((o) => o.value === symbol)) {
        const opt = document.createElement('option');
        opt.value = symbol;
        opt.textContent = symbol;
        symbolSel.prepend(opt);
      }
      symbolSel.value = symbol;
      outcomeSel.value = outcome;
      sourceSel.value = source;
      depthSel.value = String(depth);

      if (source === 'polymarket') {
        const match = (cachedPolymarketMarkets || []).find((m) => String(m?.externalId || '') === String(symbol));
        const base = match?.question ? String(match.question).slice(0, 60) : String(symbol || '').slice(0, 12);
        winEl.dataset.title = `Order Book (${base} · ${outcome})`;
        const titleEl = winEl.querySelector('.window-title');
        if (titleEl) titleEl.textContent = 'Order Book';
        windowManager?.renderWindowsMenu?.(Array.from(document.querySelectorAll('.window')));
      } else {
        setWindowTitle(winEl, symbol, source);
      }

      outcomeSel.style.display = source === 'polymarket' ? '' : 'none';
      const isPoly = source === 'polymarket';
      filterLabel.style.display = isPoly ? '' : 'none';
      filterInput.style.display = isPoly ? '' : 'none';
      slipLabel.style.display = isPoly ? '' : 'none';
      slipSideSel.style.display = isPoly ? '' : 'none';
      slipModeSel.style.display = isPoly ? '' : 'none';
      slipSizeInput.style.display = isPoly ? '' : 'none';
      slipOut.style.display = isPoly ? '' : 'none';
      infoPill.style.display = isPoly ? '' : 'none';
      posPill.style.display = isPoly ? '' : 'none';

      msgTimer = setInterval(() => {
        msgRate = msgCount;
        msgCount = 0;
        scheduleRender();
      }, 1000);

      if (source === 'mock') {
        latestBook = createMockBook(symbol, safeDepth);
        scheduleRender();
        mockTimer = setInterval(() => {
          latestBook = createMockBook(symbol, safeDepth);
          msgCount += 1;
          lastUpdate = latestBook.lastUpdate;
          scheduleRender();
        }, 80);
        return;
      }

      if (source === 'polymarket') {
        async function pollOnce() {
          try {
            const data = await fetchPolymarketClobBook(symbol, outcome, safeDepth);
            latestPolyMeta = data;
            const bidsRaw = Array.isArray(data?.bids) ? data.bids : [];
            const asksRaw = Array.isArray(data?.asks) ? data.asks : [];

            const bids = [];
            for (const r of bidsRaw) {
              const price = Number(r?.price);
              const size = Number(r?.size);
              if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
              bids.push({ price, size });
            }
            bids.sort((a, b) => b.price - a.price);

            const asks = [];
            for (const r of asksRaw) {
              const price = Number(r?.price);
              const size = Number(r?.size);
              if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
              asks.push({ price, size });
            }
            asks.sort((a, b) => a.price - b.price);

            latestBook = makeOrderBook(symbol, 'polymarket', computeTotals(bids.slice(0, safeDepth), true), computeTotals(asks.slice(0, safeDepth), false), Date.now());
            msgCount += 1;
            lastUpdate = latestBook.lastUpdate;
            setStatus('live');
            scheduleRender();
          } catch {
            // Let the status decay to DEAD; keep window stable.
          }
        }

        await pollOnce();
        pollTimer = setInterval(pollOnce, 1000);
        return;
      }

      const pair = toBinancePair(symbol);
      const binDepth = safeDepth <= 5 ? 5 : safeDepth <= 10 ? 10 : 20;
      ws = new WebSocket(`wss://stream.binance.com:9443/ws/${pair}@depth${binDepth}@100ms`);
      ws.addEventListener('open', () => setStatus('live'));
      ws.addEventListener('close', () => setStatus('dead'));
      ws.addEventListener('error', () => setStatus('dead'));
      ws.addEventListener('message', (ev) => {
        msgCount += 1;
        try {
          const msg = JSON.parse(String(ev.data || '{}'));
          latestBook = buildBookFromBinanceMsg(symbol, safeDepth, msg);
          lastUpdate = latestBook.lastUpdate;
          scheduleRender();
        } catch {
          // ignore
        }
      });
    }

    function setState(next) {
      symbol = next?.symbol || symbol;
      source = next?.source || source;
      outcome = String(next?.outcome || outcome).trim().toUpperCase() === 'NO' ? 'NO' : 'YES';
      depth = Number(next?.depth || depth);
      if (!Number.isFinite(depth) || depth <= 0) depth = 20;
      connect();
    }

    symbolSel.addEventListener('change', () => {
      const next = String(symbolSel.value || '');
      if (source === 'polymarket' && next === '__custom__') {
        const entered = prompt('Polymarket conditionId (0x...)', '');
        if (entered && entered.trim()) {
          const val = entered.trim();
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = val;
          symbolSel.prepend(opt);
          symbolSel.value = val;
          setState({ symbol: val });
        } else {
          symbolSel.value = symbol;
        }
        return;
      }
      setState({ symbol: next });
    });
    sourceSel.addEventListener('change', () => setState({ source: sourceSel.value }));
    outcomeSel.addEventListener('change', () => setState({ outcome: outcomeSel.value }));
    depthSel.addEventListener('change', () => setState({ depth: Number(depthSel.value) }));

    filterInput.addEventListener('input', () => {
      if (filterTimer) clearTimeout(filterTimer);
      filterTimer = setTimeout(async () => {
        filterQ = String(filterInput.value || '').trim().toLowerCase();
        if (source !== 'polymarket') return;
        const keep = symbol;
        await ensureSymbolsLoaded(symbolSel, source);
        // Apply filter by removing non-matching options (except CUSTOM)
        if (filterQ) {
          for (const opt of Array.from(symbolSel.options)) {
            if (opt.value === '__custom__') continue;
            const text = String(opt.textContent || '').toLowerCase();
            const val = String(opt.value || '').toLowerCase();
            opt.hidden = !(text.includes(filterQ) || val.includes(filterQ));
          }
        } else {
          for (const opt of Array.from(symbolSel.options)) opt.hidden = false;
        }
        // restore selection if possible
        const has = Array.from(symbolSel.options).some((o) => !o.hidden && o.value === keep);
        if (has) symbolSel.value = keep;
      }, 150);
    });

    slipSideSel.addEventListener('change', () => scheduleRender());
    slipModeSel.addEventListener('change', () => scheduleRender());
    slipSizeInput.addEventListener('input', () => scheduleRender());

    newBtn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('tt:open-kind', { detail: { kind: 'book', new: true, symbol, source, outcome, depth } }));
    });

    setState({ symbol, source, outcome, depth });

    return { setState, teardown, getState: () => ({ symbol, source, outcome, depth }) };
  }

  function createBookWindow(opts) {
    const fragment = tpl.content.cloneNode(true);
    const winEl = fragment.querySelector('.window');
    if (!winEl) return null;

    const id = newId('book');
    winEl.dataset.window = id;
    winEl.dataset.kind = 'book';
    winEl.dataset.workspace = getWorkspaceId();

    desktop.appendChild(fragment);
    const appended = desktop.querySelector(`.window[data-window="${id}"]`);
    if (!appended) return null;

    windowManager?.registerWindow?.(appended);
    windowManager?.applyWorkspaceToWindows?.(getWorkspaceId());
    windowManager?.focusWindowById?.(id);

    const controller = mountWindow(appended, opts);
    if (controller) controllers.set(id, controller);
    return id;
  }

  function openOrCreate(opts) {
    // focus an existing one if "new" wasn't explicitly requested
    if (!opts?.new) {
      const existing = Array.from(document.querySelectorAll('.window[data-kind="book"]')).find((w) => !w.classList.contains('is-hidden'));
      if (existing) {
        const id = existing.dataset.window;
        if (id) windowManager?.focusWindowById?.(id);
        const c = id ? controllers.get(id) : null;
        if (c && (opts?.symbol || opts?.source || opts?.depth)) c.setState(opts);
        return id || null;
      }
    }
    return createBookWindow(opts);
  }

  document.addEventListener('tt:open-kind', (e) => {
    const kind = e?.detail?.kind || '';
    if (kind !== 'book') return;
    openOrCreate(e.detail || {});
  });

  document.addEventListener('tt:window-destroy', (e) => {
    const kind = e?.detail?.kind || '';
    const id = e?.detail?.id || '';
    if (kind !== 'book' || !id) return;
    const controller = controllers.get(id);
    if (controller?.teardown) controller.teardown();
    controllers.delete(id);
  });

  document.addEventListener('tt:tool-event', (e) => {
    const ev = e?.detail;
    const outputs = ev?.outputs || [];
    const jsonOut = Array.isArray(outputs) ? outputs.find((o) => o && o.kind === 'json' && o.title === 'orderbook') : null;
    const value = jsonOut?.value;
    const symbol = value?.symbol;
    const source = value?.source;
    if (typeof symbol === 'string' && typeof source === 'string') {
      openOrCreate({ symbol, source });
    }
  });

  return { openOrCreate };
}

function setupExecution() {
  const status = $('exec-status');
  const form = $('exec-form');
  const sym = $('exec-symbol');
  const side = $('exec-side');
  const qty = $('exec-qty');
  const type = $('exec-type');
  const limit = $('exec-limit');
  const exp = $('exec-exp');

  const metricsEl = $('exec-metrics');
  const pendingEl = $('exec-pending');
  const fillsEl = $('exec-fills');
  const histEl = $('exec-history');

  if (
    !status ||
    !form ||
    !sym ||
    !side ||
    !qty ||
    !type ||
    !limit ||
    !exp ||
    !metricsEl ||
    !pendingEl ||
    !fillsEl ||
    !histEl
  ) {
    return;
  }

  function fmtBps(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return `${n.toFixed(1)} bps`;
  }

  function fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toFixed(2)}`;
  }

  function fmtTime(ts) {
    return formatTimeMs(ts);
  }

  function renderOrderRow(o, { showActions }) {
    const row = document.createElement('div');
    row.className = 'exec-row';

    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'exec-row-title';
    title.textContent = `${o.side} ${o.qty} ${o.symbol} · ${o.type}${o.type === 'LIMIT' && o.limitPrice ? ` @ ${fmtMoney(o.limitPrice)}` : ''}`;

    const meta = document.createElement('div');
    meta.className = 'exec-row-meta';
    const expected = o.expectedPrice ? `exp ${fmtMoney(o.expectedPrice)} · ` : '';
    meta.textContent = `${expected}status ${o.status} · filled ${o.filledQty}/${o.qty} · ${fmtTime(o.updatedAt)}`;

    left.appendChild(title);
    left.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'exec-actions';

    if (showActions) {
      const fillBtn = document.createElement('button');
      fillBtn.type = 'button';
      fillBtn.className = 'exec-mini';
      fillBtn.textContent = 'Fill…';
      fillBtn.addEventListener('click', async () => {
        const priceRaw = prompt('Fill price', String(o.expectedPrice || o.limitPrice || ''));
        if (priceRaw == null) return;
        const price = Number(priceRaw);
        if (!Number.isFinite(price) || price <= 0) return alert('Invalid price');
        const qtyRaw = prompt('Fill qty (blank = remaining)', '');
        const fillQty = qtyRaw && qtyRaw.trim() ? Number(qtyRaw) : undefined;
        try {
          status.textContent = 'filling';
          await fillExecutionOrder({ orderId: o.id, price, qty: fillQty });
          await poll();
        } catch (err) {
          alert(err instanceof Error ? err.message : String(err));
        } finally {
          status.textContent = 'ok';
        }
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'exec-mini exec-mini-danger';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', async () => {
        if (!confirm('Cancel this order?')) return;
        try {
          status.textContent = 'canceling';
          await cancelExecutionOrder({ orderId: o.id });
          await poll();
        } catch (err) {
          alert(err instanceof Error ? err.message : String(err));
        } finally {
          status.textContent = 'ok';
        }
      });

      actions.appendChild(fillBtn);
      actions.appendChild(cancelBtn);
    }

    row.appendChild(left);
    row.appendChild(actions);
    return row;
  }

  function renderFillRow(f) {
    const row = document.createElement('div');
    row.className = 'exec-row';

    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'exec-row-title';
    title.textContent = `FILL · ${f.side} ${f.qty} ${f.symbol} @ ${fmtMoney(f.price)}`;

    const meta = document.createElement('div');
    meta.className = 'exec-row-meta';
    const expText = f.expectedPrice ? `exp ${fmtMoney(f.expectedPrice)} · ` : '';
    const slipText = f.slippageBps == null ? 'slip —' : `slip ${fmtBps(f.slippageBps)}`;
    meta.textContent = `${expText}${slipText} · ${fmtTime(f.ts)} · ${String(f.orderId).slice(0, 12)}…`;

    left.appendChild(title);
    left.appendChild(meta);
    row.appendChild(left);
    row.appendChild(document.createElement('div'));
    return row;
  }

  let pollTimer = null;
  async function poll() {
    try {
      status.textContent = 'loading';
      const data = await fetchExecutionState();
      status.textContent = 'ok';

      const m = data.metrics || {};
      metricsEl.textContent = `fills(24h) ${m.windowFills ?? 0} · notional ${formatCompactNumber(m.windowNotional || 0)} · avg ${fmtBps(
        m.avgSlippageBps
      )} · med ${fmtBps(m.medianSlippageBps)} · p95 ${fmtBps(m.p95SlippageBps)} · worst ${fmtBps(m.worstSlippageBps)}`;

      pendingEl.innerHTML = '';
      const pending = data.pending || [];
      if (!pending.length) {
        const empty = document.createElement('div');
        empty.className = 'exec-row';
        empty.textContent = 'No pending orders';
        pendingEl.appendChild(empty);
      } else {
        for (const o of pending) pendingEl.appendChild(renderOrderRow(o, { showActions: true }));
      }

      fillsEl.innerHTML = '';
      const fills = data.fills || [];
      if (!fills.length) {
        const empty = document.createElement('div');
        empty.className = 'exec-row';
        empty.textContent = 'No fills yet';
        fillsEl.appendChild(empty);
      } else {
        for (const f of fills.slice(0, 80)) fillsEl.appendChild(renderFillRow(f));
      }

      histEl.innerHTML = '';
      const history = data.history || [];
      if (!history.length) {
        const empty = document.createElement('div');
        empty.className = 'exec-row';
        empty.textContent = 'No orders yet';
        histEl.appendChild(empty);
      } else {
        for (const o of history.slice(0, 80)) histEl.appendChild(renderOrderRow(o, { showActions: false }));
      }
    } catch (err) {
      status.textContent = 'err';
      metricsEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  function start() {
    if (pollTimer) clearInterval(pollTimer);
    poll();
    pollTimer = setInterval(poll, 3000);
  }

  function readNum(el) {
    const raw = String(el.value || '').trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const symbol = String(sym.value || '').trim().toUpperCase();
    const payload = {
      symbol,
      side: String(side.value || 'BUY'),
      qty: Number(String(qty.value || '0').trim()),
      type: String(type.value || 'MARKET'),
      limitPrice: readNum(limit),
      expectedPrice: readNum(exp)
    };
    try {
      status.textContent = 'placing';
      await placeExecutionOrder(payload);
      sym.value = symbol;
      qty.value = '';
      start();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      status.textContent = 'err';
    } finally {
      status.textContent = 'ok';
    }
  });

  type.addEventListener('change', () => {
    const isLimit = String(type.value || '').toUpperCase() === 'LIMIT';
    limit.disabled = !isLimit;
    if (!isLimit) limit.value = '';
  });
  limit.disabled = String(type.value || '').toUpperCase() !== 'LIMIT';

  start();

  return {};
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

    tabsEl.appendChild(addEl);
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
const desManager = setupDescription(() => (workspaceManager ? workspaceManager.getCurrentId() : 'default'));
const newsManager = setupNews(() => (workspaceManager ? workspaceManager.getCurrentId() : 'default'));
const polyManager = setupPolymarket(() => (workspaceManager ? workspaceManager.getCurrentId() : 'default'));
const watchlistManager = setupWatchlist(() => (workspaceManager ? workspaceManager.getCurrentId() : 'default'));
const calendarManager = setupCalendar(() => (workspaceManager ? workspaceManager.getCurrentId() : 'default'));
const portfolioManager = setupPortfolio(() => (workspaceManager ? workspaceManager.getCurrentId() : 'default'));
const rulesManager = setupRules(() => (workspaceManager ? workspaceManager.getCurrentId() : 'default'));
setupOrderBookManager(() => (workspaceManager ? workspaceManager.getCurrentId() : 'default'));
setupExecution();
setupAlerts(() => (workspaceManager ? workspaceManager.getCurrentId() : 'default'));

// Route tool events into their target windows (keeping Intel as the global trace).
document.addEventListener('tt:tool-event', (e) => {
  const ev = e?.detail;
  const target = String(ev?.targetWindow || '').trim();
  if (!target) return;

  if (target === 'news') newsManager?.applyToolEvent?.(ev);
  if (target === 'poly') polyManager?.applyToolEvent?.(ev);
});

if (workspaceManager) {
  workspaceManager.onChange((wsId) => {
    windowManager?.applyWorkspaceToWindows?.(wsId);
    chatManager?.loadWorkspace?.(wsId);
    desManager?.loadWorkspace?.(wsId);
    newsManager?.loadWorkspace?.(wsId);
    polyManager?.loadWorkspace?.(wsId);
    watchlistManager?.loadWorkspace?.(wsId);
    calendarManager?.loadWorkspace?.(wsId);
    portfolioManager?.loadWorkspace?.(wsId);
    rulesManager?.loadWorkspace?.(wsId);
  });
}

setInterval(setClock, 1000);
setClock();
setupTerminal();
setupChips();
