import { api } from '../api.js';
import { askText, confirmAction, escapeHtml } from '../ui.js';

export const groceryPanel = {
  id: 'grocery',
  title: 'Groceries',
  channel: 'grocery',
  addLabel: 'Add to the list',

  async refresh(body) {
    const { active, recent } = await api.grocery.list();

    body.innerHTML = `
      ${
        active.length
          ? `<ul class="list">
              ${active
                .map(
                  (item) => `<li class="row" data-id="${item.id}">
                    <button type="button" class="check" data-action="check" aria-label="Got it"></button>
                    <button type="button" class="row-text" data-action="edit">
                      ${escapeHtml(item.text)}
                      ${item.source !== 'local' ? `<span class="tag">${escapeHtml(item.source)}</span>` : ''}
                    </button>
                    <button type="button" class="btn-icon row-del" data-action="delete" aria-label="Remove">✕</button>
                  </li>`
                )
                .join('')}
            </ul>`
          : `<p class="empty">List is empty.</p>`
      }
      ${
        recent.length
          ? `<details class="recent">
              <summary>Recently bought (${recent.length})</summary>
              <div class="pill-row">
                ${recent
                  .map(
                    (item) => `<button type="button" class="pill" data-id="${item.id}" data-action="readd">
                      ${escapeHtml(item.text)} <span aria-hidden="true">＋</span>
                    </button>`
                  )
                  .join('')}
              </div>
            </details>`
          : ''
      }`;
  },

  bind(body) {
    body.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.closest('[data-id]').dataset.id;

      switch (btn.dataset.action) {
        case 'check':
          // Straight to "recently bought" — nothing is destroyed by a stray tap.
          await api.grocery.update(id, { checked: true });
          break;
        case 'readd':
          await api.grocery.update(id, { checked: false });
          break;
        case 'edit': {
          const { active } = await api.grocery.list();
          const item = active.find((i) => String(i.id) === id);
          const text = await askText({ title: 'Edit item', value: item.text, submitLabel: 'Save' });
          if (text) await api.grocery.update(id, { text });
          break;
        }
        case 'delete': {
          const ok = await confirmAction({
            title: 'Remove this item?',
            message: 'It will not go to "recently bought".',
            confirmLabel: 'Remove',
          });
          if (ok) await api.grocery.remove(id);
          break;
        }
      }
    });
  },

  async add() {
    // Stay open after each add: a grocery run is never one item.
    for (;;) {
      const text = await askText({
        title: 'Add to the list',
        placeholder: 'Milk',
        submitLabel: 'Add another',
      });
      if (!text) return;
      await api.grocery.add(text);
    }
  },

  menu: [
    {
      label: 'Clear recently bought',
      className: 'btn-danger',
      async onClick() {
        const ok = await confirmAction({
          title: 'Clear recently bought?',
          message: 'The re-add shortcuts will be deleted.',
          confirmLabel: 'Clear',
        });
        if (ok) await api.grocery.clearRecent();
      },
    },
  ],
};
