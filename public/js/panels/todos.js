import { api } from '../api.js';
import { openSheet, confirmAction, escapeHtml } from '../ui.js';

function memberChips(members, selected) {
  return `<div class="chip-row">
    ${members
      .map(
        (m) => `<button type="button" class="chip ${selected === m.id ? 'is-on' : ''}"
                  data-member="${m.id}" style="--chip: ${m.color}">${escapeHtml(m.name)}</button>`
      )
      .join('')}
  </div>`;
}

/** Add/edit sheet: one big field plus "whose is it?" chips. */
function todoSheet({ title, text = '', member = null, members, submitLabel }) {
  return new Promise((resolve) => {
    let picked = member;
    const form = document.createElement('form');
    form.className = 'big-form';
    form.innerHTML = `
      <input class="big-input" type="text" autocomplete="off" spellcheck="false"
             placeholder="What needs doing?" value="${escapeHtml(text)}">
      <p class="field-label">Who?</p>
      ${memberChips(members, picked)}`;

    form.addEventListener('click', (ev) => {
      const chip = ev.target.closest('[data-member]');
      if (!chip) return;
      picked = picked === chip.dataset.member ? null : chip.dataset.member;
      form.querySelectorAll('[data-member]').forEach((c) =>
        c.classList.toggle('is-on', c.dataset.member === picked)
      );
    });

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };
    const submit = () => {
      const value = form.querySelector('.big-input').value.trim();
      finish(value ? { text: value, member: picked } : null);
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

    form.querySelector('.big-input').focus();
  });
}

export const todosPanel = {
  id: 'todos',
  title: 'To-Do',
  channel: 'todos',
  addLabel: 'Add a to-do',

  async refresh(body, ctx) {
    const items = await api.todos.list();
    const open = items.filter((i) => !i.done);
    const done = items.filter((i) => i.done);

    body.innerHTML = open.length || done.length
      ? `<ul class="list">
          ${[...open, ...done].map((item) => this.row(item, ctx)).join('')}
        </ul>`
      : `<p class="empty">Nothing to do. Enjoy it.</p>`;
  },

  row(item, ctx) {
    const member = ctx.memberById(item.member);
    return `<li class="row ${item.done ? 'is-done' : ''}" data-id="${item.id}">
      <button type="button" class="check" data-action="toggle" aria-label="Toggle">
        ${item.done ? '✓' : ''}
      </button>
      <button type="button" class="row-text" data-action="edit">
        ${member ? `<span class="dot" style="--dot:${member.color}"></span>` : ''}
        ${escapeHtml(item.text)}
      </button>
      <button type="button" class="btn-icon row-del" data-action="delete" aria-label="Delete">✕</button>
    </li>`;
  },

  bind(body, ctx) {
    body.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.closest('[data-id]').dataset.id;

      if (btn.dataset.action === 'toggle') {
        const wasDone = btn.closest('.row').classList.contains('is-done');
        await api.todos.update(id, { done: !wasDone });
      } else if (btn.dataset.action === 'edit') {
        const items = await api.todos.list();
        const item = items.find((i) => String(i.id) === id);
        const result = await todoSheet({
          title: 'Edit to-do',
          text: item.text,
          member: item.member,
          members: ctx.config.members,
          submitLabel: 'Save',
        });
        if (result) await api.todos.update(id, result);
      } else if (btn.dataset.action === 'delete') {
        const ok = await confirmAction({
          title: 'Delete this to-do?',
          message: 'It will be removed from the board.',
        });
        if (ok) await api.todos.remove(id);
      }
    });
  },

  async add(ctx) {
    const result = await todoSheet({
      title: 'Add a to-do',
      members: ctx.config.members,
      submitLabel: 'Add',
    });
    if (result) await api.todos.add(result.text, result.member);
  },

  menu: [
    {
      label: 'Clear completed',
      className: 'btn-danger',
      async onClick() {
        const ok = await confirmAction({
          title: 'Clear completed to-dos?',
          message: 'Checked-off items will be deleted.',
          confirmLabel: 'Clear',
        });
        if (ok) await api.todos.clearDone();
      },
    },
  ],
};
