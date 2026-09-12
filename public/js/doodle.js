/**
 * The shared doodle: the part of the whiteboard that was never about the
 * calendar. One canvas for the whole house, saved a moment after every
 * stroke, minimised to a thumbnail in the top bar when nobody's drawing.
 */
import { onChannel } from './sse.js';
import { confirmAction } from './ui.js';
import { attachInk } from './ink.js';

const W = 1920;
const H = 1080;
const THUMB_W = 96;

// Lets this page ignore the SSE echo of its own saves.
const CLIENT_ID = Math.random().toString(36).slice(2);

const COLORS = [
  ['#1b1b1b', 'Black'],
  ['#d3272b', 'Red'],
  ['#1f6fd0', 'Blue'],
  ['#1f8a4c', 'Green'],
  ['#e08a1e', 'Orange'],
  ['#8a3fc4', 'Purple'],
];

let box = null;
let canvas = null;
let ctx = null;
let button = null;
let thumbImg = null;

let color = COLORS[0][0];
let size = 6;
let eraser = false;
let dirty = false;
let saveTimer = null;
let lastKnownUpdate = 0;

const headers = { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID };

function fitCanvas() {
  // Keep the canvas 16:9 inside whatever box it lives in, so strokes never
  // stretch. (aspect-ratio would do this in CSS, but not in Chromium 87.)
  const host = canvas.parentElement;
  const maxW = host.clientWidth;
  const maxH = host.clientHeight;
  const w = Math.min(maxW, (maxH * W) / H);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${(w * H) / W}px`;
}

function blank() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function loadFromServer() {
  const data = await fetch('/api/doodle').then((r) => r.json());
  lastKnownUpdate = data.updated_at || 0;
  blank();
  const img = await loadImage(data.png);
  if (img) ctx.drawImage(img, 0, 0, W, H);
  setThumb(data.thumb);
}

function thumbnail() {
  const small = document.createElement('canvas');
  small.width = THUMB_W;
  small.height = Math.round((THUMB_W * H) / W);
  const g = small.getContext('2d');
  g.drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL('image/png');
}

function setThumb(src) {
  if (!thumbImg) return;
  thumbImg.src = src || '';
  thumbImg.hidden = !src;
}

async function save() {
  clearTimeout(saveTimer);
  if (!dirty) return;
  dirty = false;
  const thumb = thumbnail();
  const body = JSON.stringify({ png: canvas.toDataURL('image/png'), thumb });
  const res = await fetch('/api/doodle', { method: 'PUT', headers, body }).then((r) => r.json());
  lastKnownUpdate = res.updated_at || Date.now();
  setThumb(thumb);
}

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 900);
}

let ink = null;

function bindDrawing() {
  ink = attachInk(canvas, {
    style: () => ({ color: eraser ? '#ffffff' : color, width: eraser ? 48 : size }),
    onStrokeEnd: scheduleSave,
  });
}

function toolbarHtml() {
  return `
    <div class="doodle-tools">
      <div class="doodle-colors">
        ${COLORS.map(
          ([hex, name]) =>
            `<button type="button" class="doodle-color ${hex === color ? 'is-on' : ''}"
                     data-color="${hex}" style="--c:${hex}" aria-label="${name}"></button>`
        ).join('')}
        <button type="button" class="btn btn-small" data-tool="eraser">Eraser</button>
      </div>
      <div class="doodle-sizes">
        <button type="button" class="btn btn-small" data-size="4">Thin</button>
        <button type="button" class="btn btn-small is-on" data-size="6">Marker</button>
        <button type="button" class="btn btn-small" data-size="14">Fat</button>
      </div>
      <div class="doodle-actions">
        <button type="button" class="btn btn-small btn-quiet" data-action="clear">Clear</button>
        <button type="button" class="btn btn-small" data-action="toggle">Full screen</button>
        <button type="button" class="btn btn-small btn-primary" data-action="close">Done</button>
      </div>
    </div>`;
}

function bindToolbar() {
  box.querySelector('.doodle-tools').addEventListener('click', async (ev) => {
    const el = ev.target.closest('button');
    if (!el) return;

    if (el.dataset.color) {
      color = el.dataset.color;
      eraser = false;
      box.querySelectorAll('.doodle-color').forEach((b) => b.classList.toggle('is-on', b.dataset.color === color));
      box.querySelector('[data-tool="eraser"]').classList.remove('is-on');
      return;
    }
    if (el.dataset.tool === 'eraser') {
      eraser = !eraser;
      el.classList.toggle('is-on', eraser);
      box.querySelectorAll('.doodle-color').forEach((b) => b.classList.toggle('is-on', !eraser && b.dataset.color === color));
      return;
    }
    if (el.dataset.size) {
      size = Number(el.dataset.size);
      box.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('is-on', b === el));
      return;
    }
    if (el.dataset.action === 'clear') {
      const ok = await confirmAction({
        title: 'Wipe the doodle?',
        message: 'Everyone’s drawing goes. This cannot be undone.',
        confirmLabel: 'Wipe it',
      });
      if (!ok) return;
      blank();
      dirty = false;
      await fetch('/api/doodle', { method: 'DELETE', headers });
      setThumb(null);
      return;
    }
    if (el.dataset.action === 'toggle') {
      const full = box.classList.toggle('doodle--full');
      box.classList.toggle('doodle--floating', !full);
      el.textContent = full ? 'Shrink' : 'Full screen';
      fitCanvas();
      return;
    }
    if (el.dataset.action === 'close') close();
  });
}

export async function open() {
  box.hidden = false;
  document.body.classList.add('doodle-open');
  fitCanvas();
  await loadFromServer();
}

export async function close() {
  await save();
  box.hidden = true;
  document.body.classList.remove('doodle-open');
}

export function initDoodle() {
  button = document.getElementById('doodle-button');
  thumbImg = button.querySelector('img');

  box = document.createElement('div');
  box.className = 'doodle doodle--floating';
  box.hidden = true;
  box.innerHTML = `${toolbarHtml()}<div class="doodle-stage"><canvas width="${W}" height="${H}"></canvas></div>`;
  document.body.appendChild(box);

  canvas = box.querySelector('canvas');
  ctx = canvas.getContext('2d');
  blank();

  bindDrawing();
  bindToolbar();
  button.addEventListener('click', open);
  window.addEventListener('resize', () => { if (!box.hidden) fitCanvas(); });

  // Someone else drew: refresh the thumbnail, and the canvas if it's open and
  // this hand isn't mid-stroke.
  onChannel('doodle', async (data) => {
    if (data?.origin === CLIENT_ID) return;
    if (box.hidden) {
      const { thumb } = await fetch('/api/doodle/thumb').then((r) => r.json());
      setThumb(thumb);
    } else if (!ink?.drawing && !dirty) {
      await loadFromServer();
    }
  });

  fetch('/api/doodle/thumb').then((r) => r.json()).then(({ thumb }) => setThumb(thumb)).catch(() => {});
}
