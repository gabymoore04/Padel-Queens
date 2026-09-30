-- Textos editables de la web (clave/valor). Solo se guardan los que la admin cambia.
CREATE TABLE site_content (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Galeria: el archivo vive en R2 (bucket MEDIA), aqui solo su clave.
CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album TEXT NOT NULL,                     -- Events, Torneos, Behinds, Partners
  key TEXT NOT NULL,
  caption TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_photos_album ON photos(album, sort_order);

CREATE TABLE partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  logo_key TEXT,
  link TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
