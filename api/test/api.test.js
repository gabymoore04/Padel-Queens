// Pruebas de extremo a extremo contra una D1 local real (SQLite via wrangler).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { getPlatformProxy } from "wrangler";
import worker from "../src/index.js";

let proxy, env, mails;
const BASE = "https://api.test";

before(async () => {
  proxy = await getPlatformProxy({ configPath: "api/wrangler.toml", persist: { path: ".wrangler/test-state/v3" } });
  mails = [];
  env = {
    ...proxy.env,
    TOKEN_SECRET: "test-secret", ADMIN_EMAILS: "admin@pq.test", SITE_URL: "https://site.test",
    ALLOWED_ORIGINS: "*", __mailSink: mails,
  };
});
after(async () => { await proxy.dispose(); });

async function call(method, path, body, token) {
  const res = await worker.fetch(new Request(BASE + path, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
  return { status: res.status, body: await res.json() };
}
const tokenFromMail = (to, key) => {
  const m = [...mails].reverse().find((x) => x.to === to);
  return decodeURIComponent(m.html.match(new RegExp(`${key}=([^"&]+)`))[1]);
};
async function signup(email, nombre) {
  const r = await call("POST", "/api/auth/register", { email, password: "claveSegura1", nombre });
  assert.equal(r.status, 201);
  const v = await call("POST", "/api/auth/verify", { token: tokenFromMail(email, "verify") });
  assert.equal(v.status, 200);
  return (await call("POST", "/api/auth/login", { email, password: "claveSegura1" })).body.token;
}

test("flujo completo: cuentas, pareja, pago y admin", async () => {
  const admin = await signup("admin@pq.test", "Admin");
  assert.equal((await call("GET", "/api/me", null, admin)).body.user.role, "admin");

  // Evento con inscripcion abierta
  const ev = await call("POST", "/api/admin/events", {
    title: "Torneo Test", date_label: "OCT 1", date_sub: "CLUB", description: "x", tag: "t",
    precio: 2500, cupo_max: 1, estado: "abierto", pay_link: "https://pay.test/una", pay_link_pareja: "https://pay.test/dos",
  }, admin);
  assert.equal(ev.status, 201);
  const id = ev.body.id;

  // Las jugadoras no pueden usar rutas admin
  const ana = await signup("ana@pq.test", "Ana");
  const bea = await signup("bea@pq.test", "Bea");
  assert.equal((await call("GET", "/api/admin/events", null, ana)).status, 403);

  // Lista publica: sin links de pago, registrable
  const pub = (await call("GET", "/api/events")).body.find((e) => e.id === id);
  assert.equal(pub.registrable, true);
  assert.equal(pub.pay_link, undefined);

  // Sin cuenta la companera no se puede inscribir
  assert.equal((await call("POST", `/api/events/${id}/registrations`, { partner_email: "nadie@pq.test", categoria: "3ra" }, ana)).status, 404);
  // Categoria invalida (7ma no existe)
  assert.equal((await call("POST", `/api/events/${id}/registrations`, { partner_email: "bea@pq.test", categoria: "7ma" }, ana)).status, 400);

  const reg = await call("POST", `/api/events/${id}/registrations`, { partner_email: "bea@pq.test", categoria: "3ra" }, ana);
  assert.equal(reg.status, 201);
  assert.ok(mails.some((m) => m.to === "bea@pq.test" && /invit/i.test(m.subject)));

  // Cupo de 1 pareja: el evento queda lleno
  const cara = await signup("cara@pq.test", "Cara");
  const dana = await signup("dana@pq.test", "Dana");
  assert.equal((await call("POST", `/api/events/${id}/registrations`, { partner_email: "dana@pq.test", categoria: "3ra" }, cara)).status, 409);

  // No se paga antes de que la companera confirme; solo ella puede confirmar
  assert.equal((await call("POST", `/api/registrations/${reg.body.id}/pay`, { cubre: "propia" }, ana)).status, 409);
  assert.equal((await call("POST", `/api/registrations/${reg.body.id}/confirm`, null, ana)).status, 403);
  assert.equal((await call("POST", `/api/registrations/${reg.body.id}/confirm`, null, bea)).status, 200);

  // Ana paga las dos: monto 5000 y link de pareja
  const pay = await call("POST", `/api/registrations/${reg.body.id}/pay`, { cubre: "ambas" }, ana);
  assert.equal(pay.body.monto, 5000);
  assert.equal(pay.body.pay_url, "https://pay.test/dos");
  let mine = (await call("GET", "/api/me/registrations", null, ana)).body[0];
  assert.equal(mine.pago_estado, "pendiente");

  // El admin marca pagado: ambas quedan cubiertas
  assert.equal((await call("POST", `/api/admin/payments/${pay.body.payment_id}/mark-paid`, { referencia: "CN-1" }, admin)).status, 200);
  mine = (await call("GET", "/api/me/registrations", null, bea)).body[0];
  assert.equal(mine.pago_estado, "pagado");
  assert.equal(mine.tu_parte_cubierta, true);
  assert.equal((await call("POST", `/api/registrations/${reg.body.id}/pay`, { cubre: "propia" }, bea)).status, 409);
  assert.equal((await call("POST", `/api/registrations/${reg.body.id}/cancel`, null, ana)).status, 409);

  const list = await call("GET", `/api/admin/events/${id}/registrations`, null, admin);
  assert.equal(list.body.registrations[0].pago_estado, "pagado");
});

test("recuperar contraseña y cuentas de otras jugadoras", async () => {
  await signup("eva@pq.test", "Eva");
  assert.equal((await call("POST", "/api/auth/register", { email: "EVA@pq.test", password: "claveSegura1", nombre: "Eva" })).status, 409);
  assert.equal((await call("POST", "/api/auth/login", { email: "eva@pq.test", password: "mala" })).status, 401);
  assert.equal((await call("POST", "/api/auth/forgot", { email: "noexiste@pq.test" })).status, 200);
  await call("POST", "/api/auth/forgot", { email: "eva@pq.test" });
  const t = tokenFromMail("eva@pq.test", "reset");
  assert.equal((await call("POST", "/api/auth/reset", { token: t, password: "nuevaClave99" })).status, 200);
  assert.equal((await call("POST", "/api/auth/reset", { token: t, password: "otraClave99" })).status, 400); // un solo uso
  assert.equal((await call("POST", "/api/auth/login", { email: "eva@pq.test", password: "nuevaClave99" })).status, 200);
});

test("no verificada no puede inscribirse", async () => {
  const r = await call("POST", "/api/auth/register", { email: "fay@pq.test", password: "claveSegura1", nombre: "Fay" });
  const evs = (await call("GET", "/api/events")).body;
  const res = await call("POST", `/api/events/${evs[0].id}/registrations`, { partner_email: "eva@pq.test", categoria: "4ta" }, r.body.token);
  assert.equal(res.status, 403);
});

test("admin 2A: textos, fotos R2, partners, jugadoras, resumen y CSV", async () => {
  const admin = (await call("POST", "/api/auth/login", { email: "admin@pq.test", password: "claveSegura1" })).body.token;
  const jug = (await call("POST", "/api/auth/login", { email: "ana@pq.test", password: "claveSegura1" })).body.token;

  // Textos editables: los links de pago de membresia no salen en la API publica
  assert.equal((await call("PUT", "/api/admin/content", { hero_sub: "Hola", membership_link_annual: "https://pay.test/a" }, jug)).status, 403);
  assert.equal((await call("PUT", "/api/admin/content", { whatsapp_url: "javascript:x" }, admin)).status, 400);
  assert.equal((await call("PUT", "/api/admin/content", { hero_sub: "Hola", membership_link_annual: "https://pay.test/a" }, admin)).status, 200);
  const pub = (await call("GET", "/api/content")).body;
  assert.equal(pub.hero_sub, "Hola");
  assert.equal(pub.membership_link_annual, undefined);

  // Foto a R2 y lectura publica
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const form = new FormData();
  form.set("album", "Torneos"); form.set("caption", "Final"); form.set("file", new File([png], "a.png", { type: "image/png" }));
  const up = await worker.fetch(new Request(BASE + "/api/admin/photos", { method: "POST", headers: { Authorization: `Bearer ${admin}` }, body: form }), env);
  assert.equal(up.status, 201);
  const { key, id } = await up.json();
  const img = await worker.fetch(new Request(BASE + "/media/" + key), env);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("Content-Type"), "image/png");
  assert.equal((await call("GET", "/api/photos?album=Torneos")).body.length, 1);
  const bad = new FormData(); bad.set("album", "Torneos"); bad.set("file", new File(["x"], "a.txt", { type: "text/plain" }));
  assert.equal((await worker.fetch(new Request(BASE + "/api/admin/photos", { method: "POST", headers: { Authorization: `Bearer ${admin}` }, body: bad }), env)).status, 400);
  assert.equal((await call("DELETE", `/api/admin/photos/${id}`, null, admin)).status, 200);
  assert.equal((await worker.fetch(new Request(BASE + "/media/" + key), env)).status, 404);

  // Partner sin logo
  const pf = new FormData(); pf.set("nombre", "VISA"); pf.set("link", "https://visa.test");
  assert.equal((await worker.fetch(new Request(BASE + "/api/admin/partners", { method: "POST", headers: { Authorization: `Bearer ${admin}` }, body: pf }), env)).status, 201);
  assert.equal((await call("GET", "/api/partners")).body[0].nombre, "VISA");

  // Jugadoras, rol, resumen y CSV
  const users = (await call("GET", "/api/admin/users?q=ana@pq.test", null, admin)).body.filter((u) => u.email === "ana@pq.test");
  assert.equal(users.length, 1);
  assert.equal((await call("POST", `/api/admin/users/${users[0].id}/role`, { role: "admin" }, admin)).status, 200);
  assert.equal((await call("GET", "/api/admin/summary", null, jug)).status, 200); // ahora Ana es admin
  const sum = (await call("GET", "/api/admin/summary", null, admin)).body;
  assert.ok(sum.jugadoras >= 4 && sum.cobrado === 5000);
  const evs = (await call("GET", "/api/admin/events", null, admin)).body;
  const csv = await worker.fetch(new Request(`${BASE}/api/admin/events/${evs[0].id}/registrations.csv`, { headers: { Authorization: `Bearer ${admin}` } }), env);
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /Ana/);
});
