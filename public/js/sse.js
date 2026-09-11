/**
 * Server-Sent Events with an explicit online indicator. EventSource reconnects
 * on its own; we only surface the state so the board can show it's stale.
 */
const handlers = new Map();

export function onChannel(channel, fn) {
  if (!handlers.has(channel)) handlers.set(channel, new Set());
  handlers.get(channel).add(fn);
}

export function startStream(onStatus) {
  let source;

  const connect = () => {
    source = new EventSource('/api/stream');

    source.addEventListener('open', () => onStatus?.(true));

    source.addEventListener('update', (ev) => {
      const data = JSON.parse(ev.data);
      for (const fn of handlers.get(data.channel) || []) fn(data);
    });

    source.addEventListener('error', () => {
      onStatus?.(false);
      // EventSource retries by itself; a hard reconnect only helps if it gave up.
      if (source.readyState === EventSource.CLOSED) {
        setTimeout(connect, 3000);
      }
    });
  };

  connect();
}
