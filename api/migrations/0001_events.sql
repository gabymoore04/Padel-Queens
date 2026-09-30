-- Tabla events tal como ya existe en produccion.
-- IF NOT EXISTS: es seguro aplicarla sobre la base actual sin tocar datos.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  date_label TEXT,
  date_sub TEXT,
  description TEXT,
  tag TEXT,
  tag_live INTEGER DEFAULT 0,
  pay_link TEXT,
  sort_order INTEGER DEFAULT 0
);
