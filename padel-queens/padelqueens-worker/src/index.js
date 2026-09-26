// Padel Queens — Events API + Admin login
//
// Rutas:
//   GET    /api/events            -> pública, lista de eventos (para la web)
//   POST   /api/admin/login       -> { code } -> { token }  (el "código de administrador")
//   POST   /api/admin/events      -> crear evento   (requiere Authorization: Bearer <token>)
//   PUT    /api/admin/events/:id  -> editar evento  (requiere token)
//   DELETE /api/admin/events/:id  -> borrar evento  (requiere token)
//
// Secretos necesarios (configúralos con `wrangler secret put`, NUNCA los pongas
// en este archivo ni los subas a git):
//   ADMIN_CODE     -> el código que tú escribes para entrar al panel admin
//   TOKEN_SECRET   -> una cadena aleatoria larga, solo para firmar el token de sesión

const TOKEN_TTL_SECONDS = 60 * 60 * 6; // la sesión de admin dura 6 horas

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signToken(secret) {
  const payload = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS });
  const body = btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

async function verifyToken(token, secret) {
  if (!token) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  const expected = await hmac(secret, body);
  if (expected !== sig) return false;
  try {
    const payload = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function getBearer(request) {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    // --- Público: listar eventos ---
    if (url.pathname === "/api/events" && request.method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM events ORDER BY sort_order ASC"
      ).all();
      return json(results, 200, origin);
    }

    // --- Login admin: intercambia el código por un token de sesión ---
    if (url.pathname === "/api/admin/login" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (body.code !== env.ADMIN_CODE) {
        return json({ error: "Código incorrecto" }, 401, origin);
      }
      const token = await signToken(env.TOKEN_SECRET);
      return json({ token }, 200, origin);
    }

    // --- Todo lo demás bajo /api/admin/* requiere token válido ---
    if (url.pathname.startsWith("/api/admin/")) {
      const token = getBearer(request);
      const valid = await verifyToken(token, env.TOKEN_SECRET);
      if (!valid) return json({ error: "No autorizado" }, 401, origin);

      // Crear evento
      if (url.pathname === "/api/admin/events" && request.method === "POST") {
        const e = await request.json();
        const r = await env.DB.prepare(
          `INSERT INTO events (title, date_label, date_sub, description, tag, tag_live, pay_link, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(e.title, e.date_label, e.date_sub, e.description, e.tag, e.tag_live ? 1 : 0, e.pay_link || null, e.sort_order ?? 0).run();
        return json({ id: r.meta.last_row_id }, 201, origin);
      }

      // Editar evento
      const editMatch = url.pathname.match(/^\/api\/admin\/events\/(\d+)$/);
      if (editMatch && request.method === "PUT") {
        const id = editMatch[1];
        const e = await request.json();
        await env.DB.prepare(
          `UPDATE events SET title=?, date_label=?, date_sub=?, description=?, tag=?, tag_live=?, pay_link=?, sort_order=? WHERE id=?`
        ).bind(e.title, e.date_label, e.date_sub, e.description, e.tag, e.tag_live ? 1 : 0, e.pay_link || null, e.sort_order ?? 0, id).run();
        return json({ ok: true }, 200, origin);
      }

      // Borrar evento
      if (editMatch && request.method === "DELETE") {
        const id = editMatch[1];
        await env.DB.prepare("DELETE FROM events WHERE id=?").bind(id).run();
        return json({ ok: true }, 200, origin);
      }
    }

    return json({ error: "Not found" }, 404, origin);
  },
};
