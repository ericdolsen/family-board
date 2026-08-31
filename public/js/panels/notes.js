import { api } from '../api.js';
import { openSheet, askText, confirmAction, escapeHtml } from '../ui.js';

const COLORS = ['yellow', 'blue', 'green', 'pink', 'plain'];

/** Finger-drawing sheet. Pointer events cover touch, pen and mouse alike. */
function drawingSheet(existing = null) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'draw-wrap';
    wrap.innerHTML = `
      <canvas class="draw-canvas" width="1000" height="620"></canvas>
      <div class="draw-tools">
        <button type="button" class="btn btn-small" data-tool="pen">Pen</button>
        <button type="button" class="btn btn-small" data-tool="eraser">Eraser</button>
        <button type="button" class="btn btn-small btn-quiet" data-tool="clear">Clear</button>
      </div>`;

    const canvas = wrap.querySelector('.draw-canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (existing?.body) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = existing.body;
    }

    let tool = 'pen';
    let drawing = false;

    const point = (ev) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((ev.clientX - rect.left) / rect.width) * canvas.width,
        y: ((ev.clientY - rect.top) / rect.height) * canvas.height,
      };
    };

    canvas.addEventListener('pointerdown', (ev) => {
      drawing = true;
      canvas.setPointerCapture(ev.pointerId);
      const p = point(ev);
      ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : '#1b1b1b';
      ctx.lineWidth = tool === 'eraser' ? 40 : 5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    });

    canvas.addEventListener('pointermove', (ev) => {
      if (!drawing) return;
      const p = point(ev);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });

    const stop = () => { drawing = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('pointerleave', stop);

    wrap.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-tool]');
      if (!btn) return;
      if (btn.dataset.tool === 'clear') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
      }
      tool = btn.dataset.tool;
      wrap.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('is-on', b.dataset.tool === tool));
    });

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };

    const { close } = openSheet({
      title: existing ? 'Edit drawing' : 'New drawing',
      body: wrap,
      wide: true,
      actions: [
        { label: 'Cancel', className: 'btn-quiet', onClick: () => finish(null) },
        { label: 'Save', className: 'btn-primary', onClick: () => finish(canvas.toDataURL('image/png')) },
      ],
      onClose: () => finish(null),
    });
  });
}

export const notesPanel = {
  id: 'notes',
  title: 'Notes',
  channel: 'notes',
  addLabel: 'Add a note',

  async refresh(body) {
    const notes = await api.notes.list();
    body.innerHTML = notes.length
      ? `<div class="note-grid">
          ${notes
            .map(
              (note) => `<article class="note note--${escapeHtml(note.color)}" data-id="${note.id}">
                <button type="button" class="note-open" data-action="edit">
                  ${
                    note.kind === 'drawing'
                      ? `<img class="note-img" src="${note.body}" alt="Drawing">`
                      : `<span class="note-text">${escapeHtml(note.body)}</span>`
                  }
                </button>
                <button type="button" class="btn-icon note-del" data-action="delete" aria-label="Delete note">✕</button>
              </article>`
            )
            .join('')}
        </div>`
      : `<p class="empty">No notes.</p>`;
  },

  bind(body) {
    body.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.closest('[data-id]').dataset.id;
      const notes = await api.notes.list();
      const note = notes.find((n) => String(n.id) === id);
      if (!note) return;

      if (btn.dataset.action === 'edit') {
        if (note.kind === 'drawing') {
          const png = await drawingSheet(note);
          if (png) await api.notes.update(id, { body: png });
        } else {
          const text = await askText({
            title: 'Edit note',
            value: note.body,
            multiline: true,
            submitLabel: 'Save',
          });
          if (text) await api.notes.update(id, { body: text });
        }
      } else if (btn.dataset.action === 'delete') {
        const ok = await confirmAction({
          title: 'Delete this note?',
          message: 'The note will be removed for good.',
        });
        if (ok) await api.notes.remove(id);
      }
    });
  },

  async add() {
    const choice = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        close();
        resolve(value);
      };
      const { close } = openSheet({
        title: 'Add a note',
        body: `<p class="confirm-message">Type it, or scrawl it.</p>`,
        actions: [
          { label: 'Type', className: 'btn-primary', onClick: () => finish('text') },
          { label: 'Draw', className: 'btn-primary', onClick: () => finish('drawing') },
        ],
        onClose: () => finish(null),
      });
    });

    if (choice === 'text') {
      const text = await askText({ title: 'New note', multiline: true, submitLabel: 'Add' });
      if (text) {
        await api.notes.add({ kind: 'text', body: text, color: COLORS[Math.floor(Math.random() * 4)] });
      }
    } else if (choice === 'drawing') {
      const png = await drawingSheet();
      if (png) await api.notes.add({ kind: 'drawing', body: png, color: 'plain' });
    }
  },
};
