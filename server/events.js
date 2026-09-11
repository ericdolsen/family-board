/**
 * Server-Sent Events hub. Any mutation broadcasts a small {channel, action}
 * envelope; clients refetch that channel. Deliberately not sending row payloads
 * — refetching a 20-item list is cheap and removes a whole class of
 * out-of-order-update bugs.
 */
const clients = new Set();

export function addClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function broadcast(channel, action = 'changed', extra = {}) {
  const frame = `event: update\ndata: ${JSON.stringify({ ...extra, channel, action, at: Date.now() })}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

export function clientCount() {
  return clients.size;
}
