/**
 * Finger drawing on a canvas that survives a real touch panel.
 *
 * On a 32" capacitive screen a stroke is rarely one pointer: a resting palm,
 * a knuckle, the other hand. Anything that assumes "one path at a time"
 * turns the finger's line into dots the moment a second contact lands or
 * lifts. So every pointer gets its own last-point, every move draws its own
 * short segment, and a pointer ending only ends *that* pointer.
 *
 *   attachInk(canvas, {
 *     style: () => ({ color, width }),   // asked at the start of each stroke
 *     onStrokeEnd: () => {},             // fires when a pointer lifts
 *   })
 */
export function attachInk(canvas, { style, onStrokeEnd }) {
  const ctx = canvas.getContext('2d');
  const strokes = new Map(); // pointerId -> { x, y, color, width }

  const point = (ev) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * canvas.width,
      y: ((ev.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const segment = (s, to) => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    s.x = to.x;
    s.y = to.y;
  };

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();
    try { canvas.setPointerCapture(ev.pointerId); } catch {}
    const p = point(ev);
    const s = { ...p, ...style() };
    strokes.set(ev.pointerId, s);
    // A tap with no movement still leaves a dot.
    segment(s, { x: p.x + 0.01, y: p.y });
  });

  canvas.addEventListener('pointermove', (ev) => {
    const s = strokes.get(ev.pointerId);
    if (!s) return;
    ev.preventDefault();
    // Fast strokes arrive as several coalesced samples per frame; drawing
    // through each keeps curves smooth instead of polygonal.
    const samples = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    for (const e of samples.length ? samples : [ev]) segment(s, point(e));
  });

  const end = (ev) => {
    if (!strokes.has(ev.pointerId)) return;
    strokes.delete(ev.pointerId);
    onStrokeEnd?.();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  // Deliberately no pointerleave: with capture it's spurious, and on some
  // touch stacks it fires mid-stroke.

  // touch-action:none should stop the browser turning a stroke into a pan,
  // but a few embedded Chromiums only honour the event-level veto.
  const veto = (e) => e.preventDefault();
  canvas.addEventListener('touchstart', veto, { passive: false });
  canvas.addEventListener('touchmove', veto, { passive: false });

  return {
    get drawing() {
      return strokes.size > 0;
    },
  };
}
