import { HttpError } from "./http.js";
import { verifySession } from "./crypto.js";

export const CATEGORIAS = ["1ra", "2da", "3ra", "4ta", "5ta", "6ta"];
export const SESSION_TTL = 60 * 60 * 24 * 14; // 14 dias

const bearer = (request) => {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
};

// Devuelve el usuario actual (con rol vigente en la base) o null.
export async function currentUser(request, env) {
  const uid = await verifySession(bearer(request), env.TOKEN_SECRET);
  if (!uid) return null;
  return env.DB.prepare(
    `SELECT u.id, u.email, u.email_verified, u.role, p.nombre, p.telefono, p.categoria
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?`
  ).bind(uid).first();
}

export async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, "Inicia sesión para continuar");
  return user;
}

export async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (user.role !== "admin") throw new HttpError(403, "Solo administradoras");
  return user;
}

// Las cuentas cuyo correo esta en ADMIN_EMAILS (secreto) y ya verificaron el
// correo pasan a rol admin.
export async function syncAdminRole(env, user) {
  const list = (env.ADMIN_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (user.email_verified && user.role !== "admin" && list.includes(user.email.toLowerCase())) {
    await env.DB.prepare("UPDATE users SET role='admin' WHERE id=?").bind(user.id).run();
    user.role = "admin";
  }
  return user;
}

export const publicUser = (u) => ({
  id: u.id, email: u.email, email_verified: !!u.email_verified, role: u.role,
  nombre: u.nombre, telefono: u.telefono, categoria: u.categoria,
});
