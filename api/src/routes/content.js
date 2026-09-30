import { HttpError, json, readJson, str } from "../lib/http.js";
import { requireAdmin } from "../lib/auth.js";

// Claves que la admin puede editar. Lo que no se guarda usa el texto original de la web.
export const CONTENT_KEYS = {
  hero_sub: 600, manifesto: 1200, join_title: 200, join_text: 600,
  whatsapp_url: 300, instagram_url: 300,
  benefits: 4000,                         // un beneficio por linea
  membership_price_monthly: 10, membership_price_annual: 10,
  membership_link_monthly: 500, membership_link_annual: 500,
};
const URL_KEYS = ["whatsapp_url", "instagram_url", "membership_link_monthly", "membership_link_annual"];

export async function contentRoutes(request, env, url, origin) {
  if (url.pathname === "/api/content" && request.method === "GET") {
    const { results } = await env.DB.prepare("SELECT key, value FROM site_content").all();
    const out = {};
    for (const r of results) if (!r.key.startsWith("membership_link_")) out[r.key] = r.value; // los links de pago no son publicos
    return json(out, 200, origin);
  }

  if (url.pathname === "/api/admin/content" && request.method === "GET") {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare("SELECT key, value FROM site_content").all();
    return json(Object.fromEntries(results.map((r) => [r.key, r.value])), 200, origin);
  }

  if (url.pathname === "/api/admin/content" && request.method === "PUT") {
    await requireAdmin(request, env);
    const b = await readJson(request);
    const stmts = [];
    for (const [key, max] of Object.entries(CONTENT_KEYS)) {
      if (!(key in b)) continue;
      const value = str(b[key], max);
      if (value && URL_KEYS.includes(key) && !/^https?:\/\//i.test(value)) throw new HttpError(400, "Los links deben empezar con https://");
      stmts.push(value
        ? env.DB.prepare("INSERT INTO site_content (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2, updated_at=datetime('now')").bind(key, value)
        : env.DB.prepare("DELETE FROM site_content WHERE key=?").bind(key));
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true }, 200, origin);
  }
  return null;
}
