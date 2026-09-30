import { HttpError, json, readJson, str } from "../lib/http.js";
import { requireUser, requireAdmin } from "../lib/auth.js";
import { hmac } from "../lib/crypto.js";
import { sendMail, emailLayout } from "../lib/mail.js";

const PLANES = { mensual: { usd: 10, meses: 1 }, anual: { usd: 100, meses: 12 } };

// Fecha de hoy en Republica Dominicana (UTC-4), formato YYYY-MM-DD.
const hoy = () => new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);

function addMonths(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  if (d.getUTCDate() !== day) d.setUTCDate(0); // 31 ene + 1 mes = 28/29 feb
  return d.toISOString().slice(0, 10);
}

async function precio(env, plan) {
  const row = await env.DB.prepare("SELECT value FROM site_content WHERE key=?").bind(`membership_price_${plan === "mensual" ? "monthly" : "annual"}`).first();
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : PLANES[plan].usd;
}

const estadoReal = (m) => (m.estado === "activa" && m.expires_at < hoy() ? "vencida" : m.estado);

async function carnetToken(env, userId) {
  return `${userId}.${(await hmac(env.TOKEN_SECRET, "carnet:" + userId)).slice(0, 16)}`;
}

// Activa una membresia: suma el periodo a partir de hoy o del vencimiento actual si aun esta vigente.
async function activate(env, m, adminId, referencia) {
  const prev = await env.DB.prepare("SELECT numero, expires_at FROM memberships WHERE user_id=? AND numero IS NOT NULL ORDER BY id DESC LIMIT 1").bind(m.user_id).first();
  const active = await env.DB.prepare("SELECT MAX(expires_at) AS e FROM memberships WHERE user_id=? AND estado='activa'").bind(m.user_id).first();
  // Renovacion anticipada: el nuevo periodo empieza al dia siguiente del vencimiento actual.
  const from = active.e && active.e >= hoy() ? new Date(new Date(active.e + "T00:00:00Z").getTime() + 86400000).toISOString().slice(0, 10) : hoy();
  const numero = prev ? prev.numero : "PQ-" + String(m.id).padStart(4, "0");
  const expires = addMonths(from, PLANES[m.plan].meses);
  await env.DB.prepare("UPDATE memberships SET estado='activa', numero=?, starts_at=?, expires_at=?, referencia=?, marcado_por=? WHERE id=?")
    .bind(numero, from, expires, referencia || null, adminId, m.id).run();
  const u = await env.DB.prepare("SELECT u.email, p.nombre FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=?").bind(m.user_id).first();
  await sendMail(env, {
    to: u.email, subject: "Ya eres Premium Member de Padel Queens",
    html: emailLayout("Bienvenida, Premium Member", `<p>Tu membresía está activa hasta el <b>${expires}</b>. Tu carnet digital ya está disponible.</p>`, { url: `${env.SITE_URL}/carnet.html`, label: "Ver mi carnet" }),
  });
  return { numero, expires_at: expires };
}

async function currentFor(env, userId) {
  const { results } = await env.DB.prepare("SELECT * FROM memberships WHERE user_id=? ORDER BY id DESC").bind(userId).all();
  if (!results.length) return null;
  const best = results.find((m) => estadoReal(m) === "activa") || results[0];
  return { m: best, estado: estadoReal(best), pendiente: results.find((m) => m.estado === "pendiente") || null, numero: (results.find((m) => m.numero) || {}).numero || null };
}

export async function membershipRoutes(request, env, url, origin) {
  const { pathname } = url;
  const method = request.method;

  // Validacion publica (el QR del carnet apunta aqui)
  let match = pathname.match(/^\/api\/verify\/([\w.-]+)$/);
  if (match && method === "GET") {
    const [uid, sig] = match[1].split(".");
    const expected = uid && /^\d+$/.test(uid) ? (await hmac(env.TOKEN_SECRET, "carnet:" + uid)).slice(0, 16) : null;
    if (!expected || sig !== expected) return json({ valida: false, motivo: "invalido" }, 200, origin);
    const cur = await currentFor(env, Number(uid));
    if (!cur || !cur.numero) return json({ valida: false, motivo: "invalido" }, 200, origin);
    const p = await env.DB.prepare("SELECT nombre, categoria FROM profiles WHERE user_id=?").bind(uid).first();
    const base = { nombre: p.nombre, categoria: p.categoria, numero: cur.numero, vigente_hasta: cur.m.expires_at };
    return json(cur.estado === "activa" ? { valida: true, ...base } : { valida: false, motivo: cur.estado === "vencida" ? "vencida" : "revocada", ...base }, 200, origin);
  }

  // Solicitar membresia: crea el pedido pendiente y devuelve el link de pago
  if (pathname === "/api/membership" && method === "POST") {
    const user = await requireUser(request, env);
    if (!user.email_verified) throw new HttpError(403, "Verifica tu correo antes de hacerte miembro");
    const b = await readJson(request);
    if (!PLANES[b.plan]) throw new HttpError(400, "Elige el plan mensual o anual");
    const link = await env.DB.prepare("SELECT value FROM site_content WHERE key=?").bind(`membership_link_${b.plan === "mensual" ? "monthly" : "annual"}`).first();
    if (!link) throw new HttpError(409, "El pago de este plan aún no está disponible. Escríbenos por Instagram.");
    const usd = await precio(env, b.plan);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM memberships WHERE user_id=? AND estado='pendiente'").bind(user.id),
      env.DB.prepare("INSERT INTO memberships (user_id, plan, monto_usd) VALUES (?,?,?)").bind(user.id, b.plan, usd),
    ]);
    return json({ pay_url: link.value, monto_usd: usd, plan: b.plan }, 200, origin);
  }

  if (pathname === "/api/me/membership" && method === "GET") {
    const user = await requireUser(request, env);
    const cur = await currentFor(env, user.id);
    if (!cur) return json({ membership: null }, 200, origin);
    const out = {
      estado: cur.estado, plan: cur.m.plan, vence: cur.m.expires_at, numero: cur.numero,
      pendiente: cur.pendiente ? { plan: cur.pendiente.plan, monto_usd: cur.pendiente.monto_usd } : null,
    };
    if (cur.numero) {
      out.nombre = user.nombre; out.categoria = user.categoria;
      out.verify_url = `${env.SITE_URL}/verificar.html?c=${await carnetToken(env, user.id)}`;
    }
    return json({ membership: out }, 200, origin);
  }

  // ---- Admin ----
  if (pathname === "/api/admin/memberships" && method === "GET") {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare(
      `SELECT m.*, p.nombre, u.email FROM memberships m JOIN users u ON u.id=m.user_id JOIN profiles p ON p.user_id=m.user_id ORDER BY m.id DESC LIMIT 200`
    ).all();
    return json(results.map((m) => ({ ...m, estado: estadoReal(m) })), 200, origin);
  }

  if (pathname === "/api/admin/memberships" && method === "POST") {
    const admin = await requireAdmin(request, env);
    const b = await readJson(request);
    if (!PLANES[b.plan]) throw new HttpError(400, "Plan inválido");
    const u = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(str(b.email, 200).toLowerCase()).first();
    if (!u) throw new HttpError(404, "No hay una cuenta con ese correo");
    const r = await env.DB.prepare("INSERT INTO memberships (user_id, plan, monto_usd) VALUES (?,?,?)").bind(u.id, b.plan, await precio(env, b.plan)).run();
    const res = await activate(env, { id: r.meta.last_row_id, user_id: u.id, plan: b.plan }, admin.id, str(b.referencia, 100) || "cortesía");
    return json(res, 201, origin);
  }

  match = pathname.match(/^\/api\/admin\/memberships\/(\d+)\/(activate|revoke)$/);
  if (match && method === "POST") {
    const admin = await requireAdmin(request, env);
    const m = await env.DB.prepare("SELECT * FROM memberships WHERE id=?").bind(match[1]).first();
    if (!m) throw new HttpError(404, "Membresía no encontrada");
    if (match[2] === "revoke") {
      await env.DB.prepare("UPDATE memberships SET estado='revocada' WHERE user_id=? AND estado IN ('activa','pendiente')").bind(m.user_id).run();
      return json({ ok: true }, 200, origin);
    }
    if (m.estado !== "pendiente") throw new HttpError(409, "Esta membresía ya no está pendiente");
    const b = await readJson(request).catch(() => ({}));
    return json(await activate(env, m, admin.id, str(b.referencia, 100)), 200, origin);
  }

  return null;
}
