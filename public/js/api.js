const json = async (res) => {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.status === 204 ? null : res.json();
};

const req = (method) => (url, body) =>
  fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).then(json);

export const get = (url) => fetch(url).then(json);
export const post = req('POST');
export const patch = req('PATCH');
export const del = req('DELETE');

export const api = {
  config: () => get('/api/config'),

  todos: {
    list: () => get('/api/todos'),
    add: (text, member) => post('/api/todos', { text, member }),
    update: (id, fields) => patch(`/api/todos/${id}`, fields),
    remove: (id) => del(`/api/todos/${id}`),
    clearDone: () => post('/api/todos/clear-done'),
  },

  grocery: {
    list: () => get('/api/grocery'),
    add: (text) => post('/api/grocery', { text }),
    update: (id, fields) => patch(`/api/grocery/${id}`, fields),
    remove: (id) => del(`/api/grocery/${id}`),
    clearRecent: () => post('/api/grocery/clear-recent'),
  },

  meals: {
    list: () => get('/api/meals'),
    add: (name) => post('/api/meals', { name }),
    update: (id, fields) => patch(`/api/meals/${id}`, fields),
    cooked: (id) => post(`/api/meals/${id}/cooked`),
    remove: (id) => del(`/api/meals/${id}`),
  },

  notes: {
    list: () => get('/api/notes'),
    get: (id) => get(`/api/notes/${id}`),
    add: (note) => post('/api/notes', note),
    update: (id, fields) => patch(`/api/notes/${id}`, fields),
    remove: (id) => del(`/api/notes/${id}`),
  },

  calendar: {
    events: (from, to) => get(`/api/calendar/events?from=${from}&to=${to}`),
    status: () => get('/api/calendar/status'),
    sync: () => post('/api/calendar/sync'),
  },
};
