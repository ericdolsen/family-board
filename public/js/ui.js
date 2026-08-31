/** Sheets, prompts and confirms. Everything here is finger-sized and cancelable. */

const layer = () => document.getElementById('overlay');

export function openSheet({ title, body, actions = [], onClose, wide = false }) {
  const host = layer();
  const sheet = document.createElement('div');
  sheet.className = `sheet${wide ? ' sheet--wide' : ''}`;
  sheet.innerHTML = `
    <div class="sheet-head">
      <h2>${escapeHtml(title)}</h2>
      <button type="button" class="btn btn-icon" data-close aria-label="Close">✕</button>
    </div>
    <div class="sheet-body"></div>
    <div class="sheet-actions"></div>`;

  const bodyEl = sheet.querySelector('.sheet-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);

  const actionsEl = sheet.querySelector('.sheet-actions');
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${action.className || ''}`;
    btn.textContent = action.label;
    btn.addEventListener('click', () => action.onClick(close));
    actionsEl.appendChild(btn);
  }

  function close() {
    host.classList.remove('is-open');
    host.innerHTML = '';
    onClose?.();
  }

  sheet.querySelector('[data-close]').addEventListener('click', close);
  host.innerHTML = '';
  host.appendChild(sheet);
  host.classList.add('is-open');
  // Tapping the dark area outside the sheet closes it — the escape hatch a kid
  // will find first.
  host.onclick = (ev) => { if (ev.target === host) close(); };

  return { sheet, bodyEl, close };
}

/** Big single-field entry form. Resolves to the trimmed string, or null. */
export function askText({ title, value = '', placeholder = '', submitLabel = 'Save', multiline = false }) {
  return new Promise((resolve) => {
    const form = document.createElement('form');
    form.className = 'big-form';
    form.innerHTML = multiline
      ? `<textarea class="big-input" rows="5" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>`
      : `<input class="big-input" type="text" autocomplete="off" autocapitalize="sentences"
                spellcheck="false" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}">`;

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      close();
      resolve(result);
    };

    const submit = () => {
      const text = form.querySelector('.big-input').value.trim();
      finish(text || null);
    };

    form.addEventListener('submit', (ev) => { ev.preventDefault(); submit(); });
    form.addEventListener('osk-done', submit);

    const { close } = openSheet({
      title,
      body: form,
      actions: [
        { label: 'Cancel', className: 'btn-quiet', onClick: () => finish(null) },
        { label: submitLabel, className: 'btn-primary', onClick: submit },
      ],
      onClose: () => finish(null),
    });

    const input = form.querySelector('.big-input');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

/** Destructive actions never fire on a single tap. */
export function confirmAction({ title, message, confirmLabel = 'Delete' }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      close();
      resolve(ok);
    };
    const { close } = openSheet({
      title,
      body: `<p class="confirm-message">${escapeHtml(message)}</p>`,
      actions: [
        { label: 'Cancel', className: 'btn-quiet', onClick: () => finish(false) },
        { label: confirmLabel, className: 'btn-danger', onClick: () => finish(true) },
      ],
      onClose: () => finish(false),
    });
  });
}

export function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('is-out'), 2200);
  setTimeout(() => el.remove(), 2700);
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
