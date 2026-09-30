import { HttpError, json, readJson, str } from "../lib/http.js";
import { CATEGORIAS, SESSION_TTL, currentUser, requireUser, publicUser, syncAdminRole } from "../lib/auth.js";
import { hashPassword, verifyPassword, randomToken, sha256, signSession } from "../lib/crypto.js";
import { sendMail, emailLayout } from "../lib/mail.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 86400;

function checkPassword(pw) {
  if (typeof pw !== "string" || pw.length < 8) throw new HttpError(400, "La contraseña debe tener al menos 8 caracteres");
  if (pw.length > 200) throw new HttpError(400, "Contraseña demasiado larga");
}

async function issueToken(env, userId, purpose, ttlSeconds) {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (?,?,?,?)")
    .bind(await sha256(token), userId, purpose, Math.floor(Date.now() / 1000) + ttlSeconds).run();
  return token;
}

async function consumeToken(env, token, purpose) {
  const row = await env.DB.prepare("SELECT * FROM email_tokens WHERE token_hash=? AND purpose=?")
    .bind(await sha256(String(token || "")), purpose).first();
  if (!row || row.used || row.expires_at < Math.floor(Date.now() / 1000)) {
    throw new HttpError(400, "El enlace no es válido o ya venció");
  }
  await env.DB.prepare("UPDATE email_tokens SET used=1 WHERE token_hash=?").bind(row.token_hash).run();
  return row.user_id;
}

export async function sendVerification(env, user, nombre) {
  const token = await issueToken(env, user.id, "verify", DAY);
  const url = `${env.SITE_URL}/cuenta.html?verify=${encodeURIComponent(token)}`;
  await sendMail(env, {
    to: user.email,
    subject: "Verifica tu correo en Padel Queens",
    html: emailLayout(`Bienvenida, ${nombre || ""}`.trim(), "<p>Confirma tu correo para poder inscribirte a los torneos.</p>", { url, label: "Verificar mi correo" }),
  });
}

export async function authRoutes(request, env, url, origin) {
  const { pathname } = url;
  const m = request.method;

  if (pathname === "/api/auth/register" && m === "POST") {
    const b = await readJson(request);
    const email = str(b.email, 200).toLowerCase();
    const nombre = str(b.nombre, 100);
    const categoria = str(b.categoria, 10);
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Correo inválido");
    if (!nombre) throw new HttpError(400, "Escribe tu nombre");
    if (categoria && !CATEGORIAS.includes(categoria)) throw new HttpError(400, "Categoría inválida");
    checkPassword(b.password);
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
    if (exists) throw new HttpError(409, "Ya existe una cuenta con ese correo");
    const hash = await hashPassword(b.password);
    const r = await env.DB.prepare("INSERT INTO users (email, password_hash) VALUES (?,?)").bind(email, hash).run();
    const id = r.meta.last_row_id;
    await env.DB.prepare("INSERT INTO profiles (user_id, nombre, telefono, categoria) VALUES (?,?,?,?)")
      .bind(id, nombre, str(b.telefono, 30) || null, categoria || null).run();
    await sendVerification(env, { id, email }, nombre);
    const token = await signSession(id, env.TOKEN_SECRET, SESSION_TTL);
    const user = await currentUser({ headers: new Headers({ Authorization: `Bearer ${token}` }) }, env);
    return json({ token, user: publicUser(user) }, 201, origin);
  }

  if (pathname === "/api/auth/login" && m === "POST") {
    const b = await readJson(request);
    const row = await env.DB.prepare("SELECT id, password_hash FROM users WHERE email=?").bind(str(b.email, 200).toLowerCase()).first();
    // Se verifica siempre una contrasena para no revelar si el correo existe por tiempos de respuesta.
    const ok = await verifyPassword(String(b.password || ""), row ? row.password_hash : "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    if (!row || !ok) throw new HttpError(401, "Correo o contraseña incorrectos");
    const token = await signSession(row.id, env.TOKEN_SECRET, SESSION_TTL);
    const user = await syncAdminRole(env, await currentUser({ headers: new Headers({ Authorization: `Bearer ${token}` }) }, env));
    return json({ token, user: publicUser(user) }, 200, origin);
  }

  if (pathname === "/api/auth/verify" && m === "POST") {
    const b = await readJson(request);
    const uid = await consumeToken(env, b.token, "verify");
    await env.DB.prepare("UPDATE users SET email_verified=1 WHERE id=?").bind(uid).run();
    return json({ ok: true }, 200, origin);
  }

  if (pathname === "/api/auth/resend-verification" && m === "POST") {
    const user = await requireUser(request, env);
    if (user.email_verified) return json({ ok: true }, 200, origin);
    await sendVerification(env, user, user.nombre);
    return json({ ok: true }, 200, origin);
  }

  if (pathname === "/api/auth/forgot" && m === "POST") {
    const b = await readJson(request);
    const row = await env.DB.prepare("SELECT id, email FROM users WHERE email=?").bind(str(b.email, 200).toLowerCase()).first();
    if (row) {
      const token = await issueToken(env, row.id, "reset", 3600);
      const link = `${env.SITE_URL}/cuenta.html?reset=${encodeURIComponent(token)}`;
      await sendMail(env, {
        to: row.email,
        subject: "Recupera tu contraseña de Padel Queens",
        html: emailLayout("Nueva contraseña", "<p>Usa este botón para elegir una nueva contraseña. El enlace dura 1 hora. Si no fuiste tú, ignora este correo.</p>", { url: link, label: "Elegir nueva contraseña" }),
      });
    }
    return json({ ok: true }, 200, origin); // misma respuesta exista o no el correo
  }

  if (pathname === "/api/auth/reset" && m === "POST") {
    const b = await readJson(request);
    checkPassword(b.password);
    const uid = await consumeToken(env, b.token, "reset");
    await env.DB.prepare("UPDATE users SET password_hash=?, email_verified=1 WHERE id=?").bind(await hashPassword(b.password), uid).run();
    return json({ ok: true }, 200, origin);
  }

  if (pathname === "/api/me" && m === "GET") {
    const user = await syncAdminRole(env, await requireUser(request, env));
    return json({ user: publicUser(user) }, 200, origin);
  }

  if (pathname === "/api/me" && m === "PUT") {
    const user = await requireUser(request, env);
    const b = await readJson(request);
    const nombre = str(b.nombre, 100);
    const categoria = str(b.categoria, 10);
    if (!nombre) throw new HttpError(400, "Escribe tu nombre");
    if (categoria && !CATEGORIAS.includes(categoria)) throw new HttpError(400, "Categoría inválida");
    await env.DB.prepare("UPDATE profiles SET nombre=?, telefono=?, categoria=? WHERE user_id=?")
      .bind(nombre, str(b.telefono, 30) || null, categoria || null, user.id).run();
    return json({ ok: true }, 200, origin);
  }

  return null;
}
