-- Family Board schema. Every table carries updated_at (epoch ms) and, where the
-- row can be owned by an external service, source/ext_id/dirty so a Phase 2 sync
-- adapter can reconcile without a migration.

CREATE TABLE IF NOT EXISTS todos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT    NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  done_at     INTEGER,
  member      TEXT,
  position    REAL    NOT NULL DEFAULT 0,
  source      TEXT    NOT NULL DEFAULT 'local',
  ext_id      TEXT,
  dirty       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todos_done ON todos(done, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_ext ON todos(source, ext_id) WHERE ext_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS grocery_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT    NOT NULL,
  checked     INTEGER NOT NULL DEFAULT 0,
  checked_at  INTEGER,
  position    REAL    NOT NULL DEFAULT 0,
  source      TEXT    NOT NULL DEFAULT 'local',
  ext_id      TEXT,
  dirty       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grocery_checked ON grocery_items(checked, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_grocery_ext ON grocery_items(source, ext_id) WHERE ext_id IS NOT NULL;

-- Meals: deliberately just a name + flags, but with a JSON blob so a recipe app
-- can hang ingredients/URLs off a meal later without touching this table's shape.
CREATE TABLE IF NOT EXISTS meals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  tonight     INTEGER NOT NULL DEFAULT 0,
  cooked_at   INTEGER,
  position    REAL    NOT NULL DEFAULT 0,
  data        TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL DEFAULT 'text',   -- 'text' | 'drawing'
  body        TEXT    NOT NULL DEFAULT '',       -- text content, or full-size PNG data URL for drawings
  thumb       TEXT,                              -- small PNG data URL; what the board tile renders
  color       TEXT    NOT NULL DEFAULT 'yellow',
  member      TEXT,
  position    REAL    NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- The shared whiteboard scrawl. One row today; the table shape allows pages
-- later without a migration.
CREATE TABLE IF NOT EXISTS doodles (
  id          INTEGER PRIMARY KEY,
  png         TEXT    NOT NULL DEFAULT '',   -- full-size PNG data URL, '' when blank
  thumb       TEXT,                          -- small PNG data URL for the toolbar button
  updated_at  INTEGER NOT NULL
);

-- Read-through cache of Google Calendar. Safe to delete entirely; it refills.
CREATE TABLE IF NOT EXISTS calendar_events (
  id           TEXT    NOT NULL,
  calendar_id  TEXT    NOT NULL,
  summary      TEXT    NOT NULL DEFAULT '',
  location     TEXT,
  description  TEXT,
  start_at     INTEGER NOT NULL,      -- epoch ms, local-wall-clock for all-day
  end_at       INTEGER NOT NULL,
  all_day      INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'confirmed',
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (calendar_id, id)
);
CREATE INDEX IF NOT EXISTS idx_events_span ON calendar_events(start_at, end_at);

-- Per-calendar incremental sync tokens and last-run bookkeeping.
CREATE TABLE IF NOT EXISTS sync_state (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  INTEGER NOT NULL
);

-- Phase 2: outbound changes waiting to reach an external service. Written now so
-- that offline writes are already durable when the adapters land.
CREATE TABLE IF NOT EXISTS sync_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target      TEXT    NOT NULL,       -- 'google-calendar' | 'todos' | ...
  op          TEXT    NOT NULL,       -- 'create' | 'update' | 'delete'
  entity      TEXT    NOT NULL,
  entity_id   TEXT    NOT NULL,
  payload     TEXT    NOT NULL DEFAULT '{}',
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
