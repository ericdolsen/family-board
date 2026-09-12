/**
 * In-app on-screen keyboard.
 *
 * Chromium in kiosk mode on the Pi will never pop a keyboard on focus, and the
 * board must be typeable with no hardware keyboard, ever. Phones and tablets
 * have a perfectly good native keyboard, so this stays off below a configured
 * width unless ?osk=1 forces it on.
 */

import { loadDictionary, refreshLearned, suggest } from './spell.js';

const LETTERS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const SYMBOLS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
  ['#', '%', '*', '+', '=', '_', '\\', '|', '~'],
  ['.', ',', '?', '!', "'", '<', '>'],
];

let root = null;
let target = null;
let shift = false;
let symbols = false;
let enabled = false;

export function initKeyboard({ minWidth = 1100 } = {}) {
  const forced = new URLSearchParams(location.search).get('osk');
  if (forced === '1') enabled = true;
  else if (forced === '0') enabled = false;
  else enabled = window.innerWidth >= minWidth;

  if (!enabled) return;

  root = document.createElement('div');
  root.className = 'osk';
  root.setAttribute('aria-hidden', 'true');
  document.body.appendChild(root);
  render();

  // Pointerdown, not click: never let the keyboard steal focus from the field.
  root.addEventListener('pointerdown', (ev) => {
    const pick = ev.target.closest('[data-suggest]');
    if (pick) {
      ev.preventDefault();
      applySuggestion(pick.dataset.suggest);
      return;
    }
    const key = ev.target.closest('[data-key]');
    if (!key) return;
    ev.preventDefault();
    press(key.dataset.key);
  });

  loadDictionary();

  document.addEventListener('focusin', (ev) => {
    const el = ev.target;
    if (el.matches('input[type="text"], textarea')) show(el);
  });

  document.addEventListener('focusout', (ev) => {
    // Give the next focusin a tick to land before hiding.
    setTimeout(() => {
      if (!document.activeElement?.matches('input[type="text"], textarea')) hide();
    }, 120);
  });
}

export const keyboardEnabled = () => enabled;

export function show(el) {
  if (!enabled || !root) return;
  if (target && target !== el) target.removeEventListener('input', updateSuggestions);
  target = el;
  target.addEventListener('input', updateSuggestions);
  root.classList.add('is-open');
  root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('osk-open');
  // The board's own vocabulary may have grown since last time.
  refreshLearned().then(updateSuggestions).catch(() => {});
  updateSuggestions();
}

export function hide() {
  if (!root) return;
  if (target) target.removeEventListener('input', updateSuggestions);
  target = null;
  shift = false;
  symbols = false;
  root.classList.remove('is-open');
  root.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('osk-open');
  render();
}

// ---------------------------------------------------------------- suggestions

/** The word being typed: the run of letters just before the caret. */
function currentWord() {
  if (!target) return null;
  const caret = target.selectionStart ?? target.value.length;
  const match = target.value.slice(0, caret).match(/[A-Za-z']+$/);
  if (!match) return null;
  return { word: match[0], start: caret - match[0].length, end: caret };
}

function updateSuggestions() {
  const strip = root?.querySelector('.osk-suggest');
  if (!strip) return;
  const cur = currentWord();
  const items = cur ? suggest(cur.word) : [];
  strip.innerHTML = items
    .map(
      (s) => `<button type="button" class="osk-key osk-suggestion ${s.fix ? 'is-fix' : ''}"
                data-suggest="${s.word.replace(/"/g, '&quot;')}">${s.word}</button>`
    )
    .join('');
  strip.classList.toggle('is-empty', !items.length);
}

function applySuggestion(word) {
  const cur = currentWord();
  if (!cur || !target) return;
  target.setRangeText(`${word} `, cur.start, cur.end, 'end');
  target.dispatchEvent(new Event('input', { bubbles: true }));
  if (shift) {
    shift = false;
    render();
  }
}

function press(key) {
  if (!target) return;

  switch (key) {
    case 'shift':
      shift = !shift;
      return render();
    case 'layer':
      symbols = !symbols;
      shift = false;
      return render();
    case 'back':
      return edit('');
    case 'space':
      return insert(' ');
    case 'done':
      target.form?.requestSubmit?.();
      target.dispatchEvent(new CustomEvent('osk-done', { bubbles: true }));
      return;
    default: {
      insert(shift && !symbols ? key.toUpperCase() : key);
      if (shift) {
        shift = false;
        render();
      }
    }
  }
}

function insert(text) {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  target.setRangeText(text, start, end, 'end');
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

function edit() {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  if (start === end && start > 0) target.setRangeText('', start - 1, end, 'end');
  else target.setRangeText('', start, end, 'end');
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

function keyEl(label, key, cls = '') {
  return `<button type="button" class="osk-key ${cls}" data-key="${key}">${label}</button>`;
}

function render() {
  if (!root) return;
  const rows = symbols ? SYMBOLS : LETTERS;
  const cap = (c) => (shift && !symbols ? c.toUpperCase() : c);

  const strip = root.querySelector('.osk-suggest')?.innerHTML || '';
  root.innerHTML = `
    <div class="osk-suggest is-empty">${strip}</div>
    <div class="osk-rows">
      ${rows
        .map(
          (row, i) => `<div class="osk-row">
            ${i === 3 && !symbols ? keyEl('⇧', 'shift', `osk-wide ${shift ? 'is-active' : ''}`) : ''}
            ${row.map((c) => keyEl(cap(c), c)).join('')}
            ${i === 3 ? keyEl('⌫', 'back', 'osk-wide') : ''}
          </div>`
        )
        .join('')}
      <div class="osk-row">
        ${keyEl(symbols ? 'ABC' : '?123', 'layer', 'osk-wide')}
        ${keyEl(',', ',')}
        ${keyEl('space', 'space', 'osk-space')}
        ${keyEl('.', '.')}
        ${keyEl('Done', 'done', 'osk-done')}
      </div>
    </div>`;
}
