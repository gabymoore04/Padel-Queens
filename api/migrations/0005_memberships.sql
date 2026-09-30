CREATE TABLE memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL,                                   -- mensual | anual
  monto_usd INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',             -- pendiente | activa | revocada
  numero TEXT,                                          -- N° de miembro (PQ-0001), estable en renovaciones
  starts_at TEXT,                                       -- YYYY-MM-DD
  expires_at TEXT,                                      -- YYYY-MM-DD, inclusive
  referencia TEXT,
  marcado_por INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mem_user ON memberships(user_id);
