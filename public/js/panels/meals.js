import { api } from '../api.js';
import { askText, confirmAction, escapeHtml } from '../ui.js';

export const mealsPanel = {
  id: 'meals',
  title: 'Meals We Can Make',
  channel: 'meals',
  addLabel: 'Add a meal',

  async refresh(body) {
    const meals = await api.meals.list();
    body.innerHTML = meals.length
      ? `<ul class="list">
          ${meals
            .map(
              (meal) => `<li class="row meal ${meal.tonight ? 'is-tonight' : ''}" data-id="${meal.id}">
                <button type="button" class="row-text" data-action="tonight">
                  ${meal.tonight ? '<span class="tag tag-tonight">Tonight</span>' : ''}
                  ${escapeHtml(meal.name)}
                </button>
                <button type="button" class="btn btn-small" data-action="cooked">Cooked</button>
                <button type="button" class="btn-icon row-del" data-action="delete" aria-label="Remove">✕</button>
              </li>`
            )
            .join('')}
        </ul>`
      : `<p class="empty">No meals listed.</p>`;
  },

  bind(body) {
    body.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      const row = btn.closest('[data-id]');
      const id = row.dataset.id;

      switch (btn.dataset.action) {
        case 'tonight':
          await api.meals.update(id, { tonight: !row.classList.contains('is-tonight') });
          break;
        case 'cooked': {
          const ok = await confirmAction({
            title: 'Cooked it?',
            message: 'This meal comes off the list.',
            confirmLabel: 'Cooked',
          });
          if (ok) await api.meals.cooked(id);
          break;
        }
        case 'delete': {
          const ok = await confirmAction({
            title: 'Remove this meal?',
            message: 'It will be removed from the list.',
            confirmLabel: 'Remove',
          });
          if (ok) await api.meals.remove(id);
          break;
        }
      }
    });
  },

  async add() {
    const name = await askText({ title: 'Add a meal', placeholder: 'Taco night', submitLabel: 'Add' });
    if (name) await api.meals.add(name);
  },
};
