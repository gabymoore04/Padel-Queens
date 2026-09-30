// Utilidades compartidas: API, sesion y barra de navegacion.
const API = (window.PQ_API_BASE || "").replace(/\/$/, "");
const Session = {
  get token() { try { return localStorage.getItem("pq_token"); } catch { return null; } },
  set(token) { try { localStorage.setItem("pq_token", token); } catch {} },
  clear() { try { localStorage.removeItem("pq_token"); } catch {} },
};

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (Session.token) headers.Authorization = "Bearer " + Session.token;
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("No se pudo conectar con el servidor. Intenta de nuevo en un momento.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && Session.token) Session.clear();
    throw new Error(data.error || "Algo salió mal");
  }
  return data;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rd = (n) => "RD$" + Number(n).toLocaleString("en-US");
const CATEGORIAS = ["1ra", "2da", "3ra", "4ta", "5ta", "6ta"];

async function loadMe() {
  if (!Session.token) return null;
  try { return (await api("GET", "/api/me")).user; } catch { return null; }
}

function renderNav(me) {
  const el = document.getElementById("nav-links");
  if (!el) return;
  el.innerHTML = `
    <a class="hide-sm" href="index.html#calendario">Calendario</a>
    <a class="hide-sm" href="premium.html">Premium</a>
    ${me && me.role === "admin" ? '<a href="admin.html">Admin</a>' : ""}
    <a class="nav-cta" href="cuenta.html">${me ? "Mi cuenta" : "Entrar"}</a>`;
}

function setMsg(el, text, isErr) {
  el.textContent = text || "";
  el.classList.toggle("err", !!isErr);
}

const NAV_HTML = `<header class="nav"><div class="nav-inner">
  <a class="nav-mark" href="index.html"><span class="crown-badge"><img src="assets/crown-logo-transparent.png" alt=""></span>PADEL QUEENS</a>
  <nav class="nav-links" id="nav-links"></nav></div></header>`;

// Envio de archivos (FormData): el navegador pone solo el Content-Type.
async function apiForm(method, path, form) {
  let res;
  try { res = await fetch(API + path, { method, headers: { Authorization: "Bearer " + Session.token }, body: form }); }
  catch { throw new Error("No se pudo conectar con el servidor."); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Algo salió mal");
  return data;
}
const mediaUrl = (key) => API + "/media/" + key;

const CROWN_SVG = '<svg class="crown" viewBox="-6 -2 112 74" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="round" style="overflow:visible"><path d="M8 58 L4 16 L30 36 L50 8 L70 36 L96 16 L92 58 Z" fill="currentColor" fill-opacity="0.14"/><path d="M8 58 H92"/><circle cx="4" cy="14" r="4" fill="currentColor"/><circle cx="50" cy="6" r="4" fill="currentColor"/><circle cx="96" cy="14" r="4" fill="currentColor"/></svg>';

// Textos publicos editables desde el admin (con valores por defecto).
async function loadPublicContent() {
  try { return await api("GET", "/api/content"); } catch { return {}; }
}
const fechaLarga = (iso) => {
  const M = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${M[m - 1]} ${y}`;
};
