ALTER TABLE events ADD COLUMN event_date TEXT;
ALTER TABLE events ADD COLUMN precio INTEGER;            -- RD$ por jugadora
ALTER TABLE events ADD COLUMN cupo_max INTEGER;          -- parejas; NULL = sin limite
ALTER TABLE events ADD COLUMN estado TEXT NOT NULL DEFAULT 'abierto';
ALTER TABLE events ADD COLUMN pay_link_pareja TEXT;      -- link CardNet por las dos

CREATE TABLE registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  player1_id INTEGER NOT NULL REFERENCES users(id),
  player2_id INTEGER NOT NULL REFERENCES users(id),
  categoria TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',              -- pendiente, confirmada, cancelada
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_reg_event ON registrations(event_id);
CREATE INDEX idx_reg_p1 ON registrations(player1_id);
CREATE INDEX idx_reg_p2 ON registrations(player2_id);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),         -- quien paga
  cubre TEXT NOT NULL,                                   -- propia | ambas
  monto INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',              -- pendiente, pagado
  referencia TEXT,
  marcado_por INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE INDEX idx_pay_reg ON payments(registration_id);
