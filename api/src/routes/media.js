import { HttpError, json, corsHeaders, str } from "../lib/http.js";
import { requireAdmin } from "../lib/auth.js";

export const ALBUMS = ["Events", "Torneos", "Behinds", "Partners"];
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024;

async function storeImage(env, file) {
  if (!env.MEDIA) throw new HttpError(503, "El almacenamiento de fotos (R2) no está configurado");
  if (!file || typeof file === "string") throw new HttpError(400, "Falta la imagen");
  const ext = TYPES[file.type];
  if (!ext) throw new HttpError(400, "Solo se aceptan imágenes JPG, PNG o WebP");
  if (file.size > MAX_BYTES) throw new HttpError(400, "La imagen pesa más de 5 MB");
  const key = `img/${crypto.randomUUID()}.${ext}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return key;
}
const dropImage = (env, key) => (env.MEDIA && key ? env.MEDIA.delete(key) : null);
const linkOrNull = (v) => {
  const s = str(v, 500);
  if (s && !/^https?:\/\//i.test(s)) throw new HttpError(400, "El link debe empezar con https://");
  return s || null;
};

export async function mediaRoutes(request, env, url, origin) {
  const { pathname } = url;
  const m = request.method;

  // Archivos publicos de R2
  let match = pathname.match(/^\/media\/(img\/[\w-]+\.(?:jpg|png|webp))$/);
  if (match && m === "GET") {
    const obj = env.MEDIA && (await env.MEDIA.get(match[1]));
    if (!obj) throw new HttpError(404, "No encontrado");
    return new Response(obj.body, { headers: {
      "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin",
    } });
  }

  if (pathname === "/api/photos" && m === "GET") {
    const album = url.searchParams.get("album");
    const q = album && ALBUMS.includes(album)
      ? env.DB.prepare("SELECT * FROM photos WHERE album=? ORDER BY sort_order, id DESC").bind(album)
      : env.DB.prepare("SELECT * FROM photos ORDER BY sort_order, id DESC");
    return json((await q.all()).results, 200, origin);
  }
  if (pathname === "/api/partners" && m === "GET") {
    return json((await env.DB.prepare("SELECT * FROM partners ORDER BY sort_order, id").all()).results, 200, origin);
  }

  if (!pathname.startsWith("/api/admin/")) return null;

  // --- Fotos ---
  if (pathname === "/api/admin/photos" && m === "POST") {
    await requireAdmin(request, env);
    const form = await request.formData().catch(() => { throw new HttpError(400, "Formulario inválido"); });
    const album = str(form.get("album"), 20);
    if (!ALBUMS.includes(album)) throw new HttpError(400, "Álbum inválido");
    const key = await storeImage(env, form.get("file"));
    const r = await env.DB.prepare("INSERT INTO photos (album, key, caption, sort_order) VALUES (?,?,?,?)")
      .bind(album, key, str(form.get("caption"), 200) || null, Number(form.get("sort_order")) || 0).run();
    return json({ id: r.meta.last_row_id, key }, 201, origin);
  }
  match = pathname.match(/^\/api\/admin\/photos\/(\d+)$/);
  if (match && m === "PUT") {
    await requireAdmin(request, env);
    const b = await request.json().catch(() => ({}));
    const album = str(b.album, 20);
    if (!ALBUMS.includes(album)) throw new HttpError(400, "Álbum inválido");
    await env.DB.prepare("UPDATE photos SET album=?, caption=?, sort_order=? WHERE id=?")
      .bind(album, str(b.caption, 200) || null, Number.isInteger(b.sort_order) ? b.sort_order : 0, match[1]).run();
    return json({ ok: true }, 200, origin);
  }
  if (match && m === "DELETE") {
    await requireAdmin(request, env);
    const p = await env.DB.prepare("SELECT key FROM photos WHERE id=?").bind(match[1]).first();
    if (p) { await env.DB.prepare("DELETE FROM photos WHERE id=?").bind(match[1]).run(); await dropImage(env, p.key); }
    return json({ ok: true }, 200, origin);
  }

  // --- Partners (multipart: nombre, link, sort_order, file opcional) ---
  const partnerUpsert = async (form, id) => {
    const nombre = str(form.get("nombre"), 100);
    if (!nombre) throw new HttpError(400, "El partner necesita nombre");
    const link = linkOrNull(form.get("link"));
    const order = Number(form.get("sort_order")) || 0;
    const file = form.get("file");
    const hasFile = file && typeof file !== "string" && file.size > 0;
    const key = hasFile ? await storeImage(env, file) : null;
    if (!id) {
      const r = await env.DB.prepare("INSERT INTO partners (nombre, logo_key, link, sort_order) VALUES (?,?,?,?)").bind(nombre, key, link, order).run();
      return r.meta.last_row_id;
    }
    const old = await env.DB.prepare("SELECT logo_key FROM partners WHERE id=?").bind(id).first();
    if (!old) throw new HttpError(404, "Partner no encontrado");
    await env.DB.prepare("UPDATE partners SET nombre=?, link=?, sort_order=?, logo_key=COALESCE(?, logo_key) WHERE id=?").bind(nombre, link, order, key, id).run();
    if (key) await dropImage(env, old.logo_key);
    return id;
  };
  if (pathname === "/api/admin/partners" && m === "POST") {
    await requireAdmin(request, env);
    return json({ id: await partnerUpsert(await request.formData(), null) }, 201, origin);
  }
  match = pathname.match(/^\/api\/admin\/partners\/(\d+)$/);
  if (match && m === "PUT") {
    await requireAdmin(request, env);
    return json({ id: await partnerUpsert(await request.formData(), match[1]) }, 200, origin);
  }
  if (match && m === "DELETE") {
    await requireAdmin(request, env);
    const p = await env.DB.prepare("SELECT logo_key FROM partners WHERE id=?").bind(match[1]).first();
    if (p) { await env.DB.prepare("DELETE FROM partners WHERE id=?").bind(match[1]).run(); await dropImage(env, p.logo_key); }
    return json({ ok: true }, 200, origin);
  }
  return null;
}
