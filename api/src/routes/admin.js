import { HttpError, json, readJson, str } from "../lib/http.js";
import { requireAdmin } from "../lib/auth.js";
import { sendMail, emailLayout, esc } from "../lib/mail.js";
import { ESTADOS } from "./events.js";
import { summarize } from "./registrations.js";

function url(v) {
  const s = str(v, 500);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) throw new HttpError(400, "Los links deben empezar con https://");
  return s;
}
function intOrNull(v, label) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, `${label} debe ser un número entero`);
  return n;
}

function eventFields(e) {
  const title = str(e.title, 150);
  if (!title) throw new HttpError(400, "El evento necesita título");
  const estado = str(e.estado, 20) || "abierto";
  if (!ESTADOS.includes(estado)) throw new HttpError(400, "Estado inválido");
  return [
    title, str(e.date_label, 40), str(e.date_sub, 60), str(e.description, 1000), str(e.tag, 60), e.tag_live ? 1 : 0,
    url(e.pay_link), url(e.pay_link_pareja), intOrNull(e.precio, "El precio"), intOrNull(e.cupo_max, "El cupo"),
    estado, str(e.event_date, 10) || null, intOrNull(e.sort_order, "El orden") ?? 0,
  ];
}

export async function adminRoutes(request, env, urlObj, origin) {
  const { pathname } = urlObj;
  const m = request.method;
  if (!pathname.startsWith("/api/admin/")) return null;
  const admin = await requireAdmin(request, env);

  if (pathname === "/api/admin/events" && m === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id AND r.estado IN ('pendiente','confirmada')) AS cupos_ocupados
         FROM events e ORDER BY sort_order ASC, id ASC`
    ).all();
    return json(results, 200, origin);
  }

  if (pathname === "/api/admin/events" && m === "POST") {
    const f = eventFields(await readJson(request));
    const r = await env.DB.prepare(
      `INSERT INTO events (title, date_label, date_sub, description, tag, tag_live, pay_link, pay_link_pareja, precio, cupo_max, estado, event_date, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(...f).run();
    return json({ id: r.meta.last_row_id }, 201, origin);
  }

  let match = pathname.match(/^\/api\/admin\/events\/(\d+)$/);
  if (match && m === "PUT") {
    const f = eventFields(await readJson(request));
    await env.DB.prepare(
      `UPDATE events SET title=?, date_label=?, date_sub=?, description=?, tag=?, tag_live=?, pay_link=?, pay_link_pareja=?, precio=?, cupo_max=?, estado=?, event_date=?, sort_order=? WHERE id=?`
    ).bind(...f, match[1]).run();
    return json({ ok: true }, 200, origin);
  }
  if (match && m === "DELETE") {
    const used = await env.DB.prepare("SELECT id FROM registrations WHERE event_id=? LIMIT 1").bind(match[1]).first();
    if (used) throw new HttpError(409, "Tiene inscripciones. Cámbialo a estado cerrado en vez de borrarlo.");
    await env.DB.prepare("DELETE FROM events WHERE id=?").bind(match[1]).run();
    return json({ ok: true }, 200, origin);
  }

  match = pathname.match(/^\/api\/admin\/events\/(\d+)\/registrations$/);
  if (match && m === "GET") {
    const ev = await env.DB.prepare("SELECT id, title, precio FROM events WHERE id=?").bind(match[1]).first();
    if (!ev) throw new HttpError(404, "Evento no encontrado");
    const { results: regs } = await env.DB.prepare(
      `SELECT r.*, p1.nombre AS p1_nombre, u1.email AS p1_email, p1.telefono AS p1_tel,
              p2.nombre AS p2_nombre, u2.email AS p2_email, p2.telefono AS p2_tel
         FROM registrations r
         JOIN users u1 ON u1.id=r.player1_id JOIN profiles p1 ON p1.user_id=r.player1_id
         JOIN users u2 ON u2.id=r.player2_id JOIN profiles p2 ON p2.user_id=r.player2_id
        WHERE r.event_id=? ORDER BY r.categoria, r.id`
    ).bind(ev.id).all();
    const { results: pays } = await env.DB.prepare(
      `SELECT pay.*, pr.nombre AS pagadora FROM payments pay JOIN profiles pr ON pr.user_id=pay.user_id
        WHERE pay.registration_id IN (SELECT id FROM registrations WHERE event_id=?) ORDER BY pay.id`
    ).bind(ev.id).all();
    return json({
      event: ev,
      registrations: regs.map((r) => {
        const mine = pays.filter((p) => p.registration_id === r.id);
        const s = summarize(r, mine, ev.precio);
        return { ...r, pagos: mine, pago_estado: s.pago_estado, pagado: s.pagado, total: s.total };
      }),
    }, 200, origin);
  }

  match = pathname.match(/^\/api\/admin\/payments\/(\d+)\/(mark-paid|mark-pending)$/);
  if (match && m === "POST") {
    const pay = await env.DB.prepare("SELECT * FROM payments WHERE id=?").bind(match[1]).first();
    if (!pay) throw new HttpError(404, "Pago no encontrado");
    if (match[2] === "mark-paid") {
      const b = await readJson(request).catch(() => ({}));
      await env.DB.prepare("UPDATE payments SET estado='pagado', referencia=?, marcado_por=?, paid_at=datetime('now') WHERE id=?")
        .bind(str(b.referencia, 100) || null, admin.id, pay.id).run();
      const who = await env.DB.prepare("SELECT u.email, p.nombre FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=?").bind(pay.user_id).first();
      const ev = await env.DB.prepare("SELECT e.title FROM events e JOIN registrations r ON r.event_id=e.id WHERE r.id=?").bind(pay.registration_id).first();
      await sendMail(env, {
        to: who.email, subject: `Pago recibido: ${ev.title}`,
        html: emailLayout("Pago confirmado", `<p>Recibimos tu pago de <b>RD$${pay.monto.toLocaleString("en-US")}</b> para <b>${esc(ev.title)}</b>. ¡Nos vemos en la cancha!</p>`, { url: `${env.SITE_URL}/cuenta.html`, label: "Ver mi inscripción" }),
      });
    } else {
      await env.DB.prepare("UPDATE payments SET estado='pendiente', marcado_por=NULL, paid_at=NULL WHERE id=?").bind(pay.id).run();
    }
    return json({ ok: true }, 200, origin);
  }

  return null;
}
