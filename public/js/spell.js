/**
 * Word suggestions for the on-screen keyboard.
 *
 * Two sources, merged: words the board has already seen (list items, events,
 * notes, the family's names) ahead of a base list of common English words.
 * suggest() returns completions of what's being typed, and — when the word
 * isn't known — the closest known words first. It never decides anything on
 * its own; a tap on a suggestion is the only thing that changes text.
 */

const words = [];           // in rank order
const rank = new Map();     // lowercase -> rank (lower = more likely)
const display = new Map();  // lowercase -> preferred casing
const byLength = new Map(); // length -> lowercase words

let loading = null;
const baseWords = new Set(); // lowercase words from the shipped list

/**
 * A learned word keeps its casing only when the base list doesn't know it —
 * that's what makes "Taliesin" a name and "The" (from an event title) just
 * "the".
 */
function displayForm(form) {
  const key = form.toLowerCase();
  return baseWords.has(key) ? key : form;
}

function addWord(form, r) {
  const key = form.toLowerCase();
  if (rank.has(key)) return;
  rank.set(key, r);
  display.set(key, displayForm(form));
  words.push(key);
  if (!byLength.has(key.length)) byLength.set(key.length, []);
  byLength.get(key.length).push(key);
}

export function loadDictionary() {
  if (loading) return loading;
  loading = (async () => {
    const [learned, base] = await Promise.all([
      fetch('/api/spell/learned').then((r) => r.json()).catch(() => []),
      fetch('/dict/en-base.txt').then((r) => r.text()).catch(() => ''),
    ]);
    const baseList = base.split(/\s+/).filter(Boolean);
    for (const w of baseList) baseWords.add(w.toLowerCase());
    let r = 0;
    for (const w of learned) addWord(w, r++);
    for (const w of baseList) addWord(w, r++);
  })();
  return loading;
}

/** Re-pull the learned words (cheap; called when the keyboard opens). */
export async function refreshLearned() {
  const learned = await fetch('/api/spell/learned').then((r) => r.json()).catch(() => []);
  // Learned words outrank everything: give them negative ranks.
  learned.forEach((w, i) => {
    const key = w.toLowerCase();
    if (!rank.has(key)) {
      addWord(w, -learned.length + i);
    } else {
      rank.set(key, Math.min(rank.get(key), -learned.length + i));
      if (/^[A-Z]/.test(w) && !baseWords.has(key)) display.set(key, w);
    }
  });
}

export const isKnown = (word) => rank.has(String(word).toLowerCase());

/** Damerau-Levenshtein with a cutoff; returns Infinity past `max`. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return Infinity;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  let prev2 = null;
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return Infinity;
    prev2 = prev.slice();
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length] <= max ? prev[b.length] : Infinity;
}

function cased(key, typed) {
  const form = display.get(key) || key;
  if (/^[A-Z]/.test(form) && form !== key) return form; // a proper noun keeps its casing
  if (typed[0] && typed[0] === typed[0].toUpperCase() && typed[0] !== typed[0].toLowerCase()) {
    return form[0].toUpperCase() + form.slice(1);
  }
  return form;
}

/**
 * @returns {{ word: string, fix: boolean }[]} up to `limit` suggestions;
 *          fix=true marks a correction of an unknown word.
 */
export function suggest(typed, limit = 4) {
  const w = String(typed || '').toLowerCase();
  if (w.length < 2 || !words.length) return [];
  const seen = new Set([w]);
  const known = rank.has(w);

  // Completions, in rank order (the list is already sorted by rank).
  const completions = [];
  for (const key of words) {
    if (completions.length >= limit) break;
    if (key.length > w.length && key.startsWith(w) && !seen.has(key)) {
      seen.add(key);
      completions.push({ word: cased(key, typed), fix: false });
    }
  }

  // Corrections, only when what's typed isn't itself a word.
  const corrections = [];
  if (!known && w.length >= 3) {
    const max = w.length >= 6 ? 2 : 1;
    const candidates = [];
    // Never "correct" to a 2-letter token: the base list has a few ("th").
    for (let len = Math.max(3, w.length - max); len <= w.length + max; len++) {
      for (const key of byLength.get(len) || []) {
        const d = distance(w, key, max);
        if (d !== Infinity) candidates.push({ key, d, r: rank.get(key) });
      }
    }
    candidates.sort((a, b) => a.d - b.d || a.r - b.r);
    for (const c of candidates) {
      if (corrections.length >= limit) break;
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      corrections.push({ word: cased(c.key, typed), fix: true });
    }
  }

  // "Dext" is on its way to "Dexter", not a misspelling of "next": a prefix
  // that completes to a real word leads, corrections follow. With nothing to
  // complete (tomorow, Wensday) the corrections take the whole strip.
  const lead = completions.slice(0, corrections.length ? 2 : limit);
  return [...lead, ...corrections, ...completions.slice(lead.length)].slice(0, limit);
}
