/**
 * Wall-clock <-> epoch conversion in a named IANA timezone, with no library.
 * The board's config names the family's timezone; the Pi's own zone is never
 * trusted for anything a person will read.
 */

const fmtCache = new Map();

function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(
      tz,
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    );
  }
  return fmtCache.get(tz);
}

const pad = (n) => String(n).padStart(2, '0');

function partsAt(ms, tz) {
  const parts = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return parts;
}

/** Minutes east of UTC that `tz` is at the instant `ms`. */
export function tzOffsetMinutes(ms, tz) {
  const p = partsAt(ms, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - ms) / 60000);
}

/** 'YYYY-MM-DD' + 'HH:MM' in `tz` -> epoch ms. Two passes handle DST edges. */
export function wallToEpoch(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ms = guess - tzOffsetMinutes(guess, tz) * 60000;
  ms = guess - tzOffsetMinutes(ms, tz) * 60000;
  return ms;
}

/** epoch ms -> { date: 'YYYY-MM-DD', time: 'HH:MM' } in `tz`. */
export function epochToWall(ms, tz) {
  const p = partsAt(ms, tz);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${pad(+p.hour % 24)}:${p.minute}`,
  };
}

/** 'YYYY-MM-DD' plus n days, done in UTC so DST can't shift the date. */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
export const isTime = (s) => /^\d{2}:\d{2}$/.test(String(s || ''));
