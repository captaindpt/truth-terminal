function $(id) {
  return document.getElementById(id);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
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

function windowStorageKey(id) {
  return `tt:window:${id}`;
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
    const raw = localStorage.getItem(windowStorageKey(id));
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

function saveWindowGeometry(id, geom) {
  try {
    localStorage.setItem(windowStorageKey(id), JSON.stringify(geom));
  } catch {
    // ignore
  }
}

function bringToFront(el, state) {
  state.z += 1;
  el.style.zIndex = String(state.z);
}

function setupWindows() {
  const desktop = $('desktop');
  if (!desktop) return;

  const windows = Array.from(desktop.querySelectorAll('.window'));
  const state = { z: 10 };
  const MIN_W = 320;
  const MIN_H = 180;

  function setFocused(target) {
    for (const w of windows) w.classList.remove('is-focused');
    target.classList.add('is-focused');
  }

  for (const win of windows) {
    const id = win.dataset.window;
    if (!id) continue;

    const fallback = readWindowGeometry(win);
    const geom = loadWindowGeometry(id, fallback);
    applyWindowGeometry(win, geom);
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
          saveWindowGeometry(id, { x, y, w, h });
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
          saveWindowGeometry(id, { x, y, w, h });
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

  return { renderWindowsMenu };
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

setInterval(setClock, 1000);
setClock();
setupWindows();
setupTerminal();
setupChips();
