import { HttpError, json, readJson, str } from "../lib/http.js";
import { CATEGORIAS, requireUser } from "../lib/auth.js";
import { sendMail, emailLayout, esc } from "../lib/mail.js";
import { getEvent } from "./events.js";

// Que jugadoras tienen su parte cubierta segun los pagos confirmados.
export function summarize(reg, payments, precio) {
  const covered = { [reg.player1_id]: false, [reg.player2_id]: false };
  let pagado = 0;
  for (const p of payments) {
    if (p.estado !== "pagado") continue;
    pagado += p.monto;
    if (p.cubre === "ambas") { covered[reg.player1_id] = true; covered[reg.player2_id] = true; }
    else covered[p.user_id] = true;
  }
  const n = Object.values(covered).filter(Boolean).length;
  return {
    covered, pagado,
    total: precio == null ? null : precio * 2,
    pago_estado: n === 2 ? "pagado" : n === 1 ? "parcial" : "pendiente",
  };
}

const isActive = (r) => r.estado === "pendiente" || r.estado === "confirmada";

async function getReg(env, id) {
  const reg = await env.DB.prepare("SELECT * FROM registrations WHERE id=?").bind(id).first();
  if (!reg) throw new HttpError(404, "Inscripción no encontrada");
  return reg;
}

function mustBePlayer(reg, user) {
  if (reg.player1_id !== user.id && reg.player2_id !== user.id) throw new HttpError(403, "Esta inscripción no es tuya");
}

export async function listForUser(env, userId) {
  const { results: regs } = await env.DB.prepare(
    `SELECT r.*, e.title, e.date_label, e.date_sub, e.precio, e.pay_link, e.pay_link_pareja,
            p1.nombre AS p1_nombre, u1.email AS p1_email, p2.nombre AS p2_nombre, u2.email AS p2_email
       FROM registrations r
       JOIN events e ON e.id = r.event_id
       JOIN users u1 ON u1.id = r.player1_id JOIN profiles p1 ON p1.user_id = r.player1_id
       JOIN users u2 ON u2.id = r.player2_id JOIN profiles p2 ON p2.user_id = r.player2_id
      WHERE (r.player1_id = ?1 OR r.player2_id = ?1) AND r.estado != 'cancelada'
      ORDER BY r.id DESC`
  ).bind(userId).all();
  if (!regs.length) return [];
  const ids = regs.map((r) => r.id);
  const { results: pays } = await env.DB.prepare(
    `SELECT * FROM payments WHERE registration_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`
  ).bind(...ids).all();
  return regs.map((r) => {
    const mine = pays.filter((p) => p.registration_id === r.id);
    const s = summarize(r, mine, r.precio);
    const tuParteCubierta = s.covered[userId];
    const parejaCubierta = s.covered[userId === r.player1_id ? r.player2_id : r.player1_id];
    return {
      id: r.id, event_id: r.event_id, event_title: r.title, date_label: r.date_label, date_sub: r.date_sub,
      categoria: r.categoria, estado: r.estado, rol: r.player1_id === userId ? "organizadora" : "invitada",
      companera: userId === r.player1_id ? { nombre: r.p2_nombre, email: r.p2_email } : { nombre: r.p1_nombre, email: r.p1_email },
      precio: r.precio, pago_estado: s.pago_estado, pagado: s.pagado, total: s.total,
      tu_parte_cubierta: tuParteCubierta, pareja_cubierta: parejaCubierta,
      opciones_pago: r.estado !== "confirmada" || r.precio == null || tuParteCubierta ? [] : [
        ...(r.pay_link ? [{ cubre: "propia", monto: r.precio }] : []),
        ...(!parejaCubierta && r.pay_link_pareja ? [{ cubre: "ambas", monto: r.precio * 2 }] : []),
      ],
      pagos: mine.map((p) => ({ id: p.id, cubre: p.cubre, monto: p.monto, estado: p.estado, pagadora_es_tu: p.user_id === userId })),
    };
  });
}

export async function registrationRoutes(request, env, url, origin) {
  const { pathname } = url;
  const m = request.method;

  let match = pathname.match(/^\/api\/events\/(\d+)\/registrations$/);
  if (match && m === "POST") {
    const user = await requireUser(request, env);
    if (!user.email_verified) throw new HttpError(403, "Verifica tu correo antes de inscribirte");
    const b = await readJson(request);
    const categoria = str(b.categoria, 10);
    const partnerEmail = str(b.partner_email, 200).toLowerCase();
    if (!CATEGORIAS.includes(categoria)) throw new HttpError(400, "Elige una categoría válida");
    const ev = await getEvent(env, match[1]);
    if (!ev || ev.estado === "borrador") throw new HttpError(404, "Evento no encontrado");
    if (ev.estado !== "abierto" || ev.precio == null) throw new HttpError(409, "Las inscripciones de este evento no están abiertas");
    if (ev.cupo_max != null && ev.cupos_ocupados >= ev.cupo_max) throw new HttpError(409, "El evento está lleno");
    const partner = await env.DB.prepare(
      "SELECT u.id, u.email, p.nombre FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.email=?"
    ).bind(partnerEmail).first();
    if (!partner) throw new HttpError(404, "Tu compañera todavía no tiene cuenta. Pídele que se registre y vuelve a intentar.");
    if (partner.id === user.id) throw new HttpError(400, "Tu compañera debe ser otra jugadora");
    const dup = await env.DB.prepare(
      `SELECT id FROM registrations WHERE event_id=?1 AND estado IN ('pendiente','confirmada')
         AND (player1_id IN (?2,?3) OR player2_id IN (?2,?3))`
    ).bind(ev.id, user.id, partner.id).first();
    if (dup) throw new HttpError(409, "Tú o tu compañera ya están inscritas en este evento");
    const r = await env.DB.prepare("INSERT INTO registrations (event_id, player1_id, player2_id, categoria) VALUES (?,?,?,?)")
      .bind(ev.id, user.id, partner.id, categoria).run();
    await sendMail(env, {
      to: partner.email,
      subject: `${user.nombre} te invitó a jugar ${ev.title}`,
      html: emailLayout("Te invitaron a una pareja", `<p><b>${esc(user.nombre)}</b> te inscribió como su compañera en <b>${esc(ev.title)}</b> (categoría ${esc(categoria)}).</p><p>Entra a tu cuenta para confirmar o rechazar la invitación.</p>`, { url: `${env.SITE_URL}/cuenta.html`, label: "Ver invitación" }),
    });
    return json({ id: r.meta.last_row_id, estado: "pendiente" }, 201, origin);
  }

  if (pathname === "/api/me/registrations" && m === "GET") {
    const user = await requireUser(request, env);
    return json(await listForUser(env, user.id), 200, origin);
  }

  match = pathname.match(/^\/api\/registrations\/(\d+)\/(confirm|cancel|pay)$/);
  if (match && m === "POST") {
    const user = await requireUser(request, env);
    const reg = await getReg(env, match[1]);
    mustBePlayer(reg, user);
    const action = match[2];

    if (action === "confirm") {
      if (reg.player2_id !== user.id) throw new HttpError(403, "Solo la compañera invitada puede confirmar");
      if (!user.email_verified) throw new HttpError(403, "Verifica tu correo antes de confirmar");
      if (reg.estado !== "pendiente") throw new HttpError(409, "Esta invitación ya no está pendiente");
      await env.DB.prepare("UPDATE registrations SET estado='confirmada' WHERE id=?").bind(reg.id).run();
      const org = await env.DB.prepare("SELECT u.email, p.nombre FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=?").bind(reg.player1_id).first();
      const ev = await getEvent(env, reg.event_id);
      await sendMail(env, {
        to: org.email, subject: `Inscripción confirmada: ${ev.title}`,
        html: emailLayout("Pareja confirmada", `<p><b>${esc(user.nombre)}</b> aceptó jugar contigo en <b>${esc(ev.title)}</b>. Ya pueden pagar su inscripción desde su cuenta.</p>`, { url: `${env.SITE_URL}/cuenta.html`, label: "Ir a mi cuenta" }),
      });
      return json({ ok: true, estado: "confirmada" }, 200, origin);
    }

    if (action === "cancel") {
      if (!isActive(reg)) throw new HttpError(409, "La inscripción ya estaba cancelada");
      const paid = await env.DB.prepare("SELECT id FROM payments WHERE registration_id=? AND estado='pagado' LIMIT 1").bind(reg.id).first();
      if (paid) throw new HttpError(409, "Ya hay un pago registrado. Escríbenos para gestionar la cancelación.");
      await env.DB.batch([
        env.DB.prepare("UPDATE registrations SET estado='cancelada' WHERE id=?").bind(reg.id),
        env.DB.prepare("DELETE FROM payments WHERE registration_id=? AND estado='pendiente'").bind(reg.id),
      ]);
      return json({ ok: true }, 200, origin);
    }

    // pay
    if (reg.estado !== "confirmada") throw new HttpError(409, "Podrán pagar cuando la pareja esté confirmada");
    const b = await readJson(request);
    const ev = await getEvent(env, reg.event_id);
    if (ev.precio == null) throw new HttpError(409, "Este evento no tiene precio configurado");
    const { results: pays } = await env.DB.prepare("SELECT * FROM payments WHERE registration_id=?").bind(reg.id).all();
    const s = summarize(reg, pays, ev.precio);
    const partnerId = user.id === reg.player1_id ? reg.player2_id : reg.player1_id;
    if (s.covered[user.id]) throw new HttpError(409, "Tu parte ya está pagada");
    let monto, link;
    if (b.cubre === "propia") { monto = ev.precio; link = ev.pay_link; }
    else if (b.cubre === "ambas") {
      if (s.covered[partnerId]) throw new HttpError(409, "Tu compañera ya pagó su parte");
      monto = ev.precio * 2; link = ev.pay_link_pareja;
    } else throw new HttpError(400, "Elige si pagas tu parte o las dos");
    if (!link) throw new HttpError(409, "Este evento aún no tiene el link de pago configurado");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM payments WHERE registration_id=? AND user_id=? AND estado='pendiente'").bind(reg.id, user.id),
      env.DB.prepare("INSERT INTO payments (registration_id, user_id, cubre, monto) VALUES (?,?,?,?)").bind(reg.id, user.id, b.cubre, monto),
    ]);
    const pay = await env.DB.prepare("SELECT id FROM payments WHERE registration_id=? AND user_id=? AND estado='pendiente'").bind(reg.id, user.id).first();
    return json({ payment_id: pay.id, monto, pay_url: link }, 200, origin);
  }

  return null;
}
