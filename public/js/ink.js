/**
 * Finger drawing on a canvas that survives a real touch panel.
 *
 * Two things go wrong on big touch screens that never happen with a mouse:
 *
 *  1. Extra contacts. A resting palm, a knuckle, the other hand. Anything that
 *     assumes "one path at a time" turns the finger's line into dots the
 *     moment a second contact lands or lifts. So every pointer gets its own
 *     last-point and every move draws its own short segment.
 *
 *  2. Flaky contact. Some controllers (or the browser in front of them) report
 *     a moving finger as a burst of separate touches: down, up, down, up… each
 *     a few pixels on. Drawn naively that is a dotted line. So a new touch
 *     that lands within STITCH_MS and STITCH_PX of where the last one lifted
 *     is treated as the same stroke, and the gap is drawn.
 *
 *   attachInk(canvas, {
 *     style: () => ({ color, width }),   // asked at the start of each stroke
 *     onStrokeEnd: () => {},             // fires when a pointer lifts
 *     debug: (record) => {},             // optional: every pointer event
 *   })
 */
const STITCH_MS = 250;
const STITCH_PX = 90;

export function attachInk(canvas, { style, onStrokeEnd, debug }) {
  const ctx = canvas.getContext('2d');
  const strokes = new Map(); // pointerId -> { x, y, color, width }
  let lastLift = null;       // { x, y, t, color, width } of the most recent pointerup
  const t0 = performance.now();

  const point = (ev) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * canvas.width,
      y: ((ev.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const log = (ev, extra = {}) => {
    if (!debug) return;
    const p = point(ev);
    debug({
      t: Math.round(performance.now() - t0),
      type: ev.type.replace('pointer', ''),
      id: ev.pointerId,
      kind: ev.pointerType,
      primary: ev.isPrimary,
      buttons: ev.buttons,
      pressure: Number(ev.pressure?.toFixed(2)),
      x: Math.round(p.x),
      y: Math.round(p.y),
      ...extra,
    });
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
    const now = performance.now();

    // Continuation of a touch that just lifted a hair away? Bridge the gap.
    const stitched =
      lastLift &&
      now - lastLift.t <= STITCH_MS &&
      Math.hypot(p.x - lastLift.x, p.y - lastLift.y) <= STITCH_PX;

    const s = stitched
      ? { x: lastLift.x, y: lastLift.y, color: lastLift.color, width: lastLift.width }
      : { ...p, ...style() };
    strokes.set(ev.pointerId, s);
    log(ev, { stitched: Boolean(stitched), active: strokes.size });

    if (stitched) segment(s, p);
    // A tap with no movement still leaves a dot.
    else segment(s, { x: p.x + 0.01, y: p.y });
  });

  canvas.addEventListener('pointermove', (ev) => {
    const s = strokes.get(ev.pointerId);
    if (!s) {
      if (debug && ev.buttons) log(ev, { orphan: true });
      return;
    }
    ev.preventDefault();
    // Fast strokes arrive as several coalesced samples per frame; drawing
    // through each keeps curves smooth instead of polygonal.
    const samples = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    log(ev, { coalesced: samples.length });
    for (const e of samples.length ? samples : [ev]) segment(s, point(e));
  });

  const end = (ev) => {
    const s = strokes.get(ev.pointerId);
    log(ev, { active: strokes.size - (s ? 1 : 0) });
    if (!s) return;
    strokes.delete(ev.pointerId);
    lastLift = { x: s.x, y: s.y, t: performance.now(), color: s.color, width: s.width };
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

  if (debug) {
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      canvas.addEventListener(type, (e) => debug({ t: Math.round(performance.now() - t0), type, touches: e.touches.length }), { passive: true });
    }
    for (const type of ['mousedown', 'mouseup']) {
      canvas.addEventListener(type, (e) => debug({ t: Math.round(performance.now() - t0), type, button: e.button }));
    }
  }

  return {
    get drawing() {
      return strokes.size > 0;
    },
  };
}
