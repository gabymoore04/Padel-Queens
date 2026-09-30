import { HttpError, json } from "../lib/http.js";

export const ESTADOS = ["borrador", "abierto", "cerrado", "en_juego", "finalizado"];

const OCUPADOS = `(SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.estado IN ('pendiente','confirmada'))`;

export function shapePublic(e) {
  const tienePrecio = e.precio !== null && e.precio !== undefined;
  const lleno = e.cupo_max !== null && e.cupos_ocupados >= e.cupo_max;
  const out = { ...e, registrable: e.estado === "abierto" && tienePrecio && !lleno, lleno };
  // Los links de pago de eventos con inscripcion solo se entregan al pagar desde la cuenta.
  if (tienePrecio) { delete out.pay_link; delete out.pay_link_pareja; }
  return out;
}

export async function getEvent(env, id) {
  return env.DB.prepare(`SELECT e.*, ${OCUPADOS} AS cupos_ocupados FROM events e WHERE e.id = ?`).bind(id).first();
}

export async function eventRoutes(request, env, url, origin) {
  if (request.method !== "GET") return null;

  if (url.pathname === "/api/events") {
    const { results } = await env.DB.prepare(
      `SELECT e.*, ${OCUPADOS} AS cupos_ocupados FROM events e WHERE e.estado != 'borrador' ORDER BY e.sort_order ASC, e.id ASC`
    ).all();
    return json(results.map(shapePublic), 200, origin);
  }

  const m = url.pathname.match(/^\/api\/events\/(\d+)$/);
  if (m) {
    const e = await getEvent(env, m[1]);
    if (!e || e.estado === "borrador") throw new HttpError(404, "Evento no encontrado");
    return json(shapePublic(e), 200, origin);
  }
  return null;
}
