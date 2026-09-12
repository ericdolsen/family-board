import { api } from '../api.js';
import { openSheet, askText, confirmAction, escapeHtml } from '../ui.js';
import { attachInk } from '../ink.js';

const COLORS = ['yellow', 'blue', 'green', 'pink', 'plain'];

// Full-size drawings are only ever decoded one at a time, in the editor. The
// board tile shows a thumbnail: at 400px wide it decodes to ~0.4 MB instead of
// ~2.5 MB, which is the difference between fifty drawings costing 20 MB and
// costing 125 MB in a browser tab that runs for months.
const DRAW_W = 1000;
const DRAW_H = 620;
const THUMB_W = 400;

function thumbnailOf(canvas) {
  const small = document.createElement('canvas');
  small.width = THUMB_W;
  small.height = Math.round((THUMB_W * DRAW_H) / DRAW_W);
  const ctx = small.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL('image/png');
}

/** Finger-drawing sheet. Pointer events cover touch, pen and mouse alike. */
function drawingSheet(existing = null) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'draw-wrap';
    wrap.innerHTML = `
      <canvas class="draw-canvas" width="${DRAW_W}" height="${DRAW_H}"></canvas>
      <div class="draw-tools">
        <button type="button" class="btn btn-small is-on" data-tool="pen">Pen</button>
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
    attachInk(canvas, {
      style: () => ({ color: tool === 'eraser' ? '#ffffff' : '#1b1b1b', width: tool === 'eraser' ? 40 : 5 }),
    });

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
        {
          label: 'Save',
          className: 'btn-primary',
          onClick: () => finish({ body: canvas.toDataURL('image/png'), thumb: thumbnailOf(canvas) }),
        },
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
                      ? `<img class="note-img" src="${note.thumb || ''}" alt="Drawing">`
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

      if (btn.dataset.action === 'delete') {
        const ok = await confirmAction({
          title: 'Delete this note?',
          message: 'The note will be removed for good.',
        });
        if (ok) await api.notes.remove(id);
        return;
      }

      // Only now fetch the full-size body, for this one note.
      const note = await api.notes.get(id).catch(() => null);
      if (!note) return;

      if (note.kind === 'drawing') {
        const result = await drawingSheet(note);
        if (result) await api.notes.update(id, result);
      } else {
        const text = await askText({
          title: 'Edit note',
          value: note.body,
          multiline: true,
          submitLabel: 'Save',
        });
        if (text) await api.notes.update(id, { body: text });
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
      const result = await drawingSheet();
      if (result) await api.notes.add({ kind: 'drawing', color: 'plain', ...result });
    }
  },
};
