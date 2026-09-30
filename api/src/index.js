// Padel Queens API (Cloudflare Worker + D1)
//
// Publico:   GET /api/events, GET /api/events/:id
// Cuentas:   POST /api/auth/{register,login,verify,resend-verification,forgot,reset}, GET|PUT /api/me
// Jugadora:  POST /api/events/:id/registrations, GET /api/me/registrations,
//            POST /api/registrations/:id/{confirm,cancel,pay}
// Membresia: POST /api/membership, GET /api/me/membership, GET /api/verify/:token
// Contenido: GET /api/content, /api/photos, /api/partners, /media/*
// Admin:     /api/admin/* (requiere rol admin): eventos, inscripciones, pagos, fotos, partners, textos, jugadoras
//
// Secretos (wrangler secret put): TOKEN_SECRET, ADMIN_EMAILS, RESEND_API_KEY
// Variables (wrangler.toml): ALLOWED_ORIGINS, SITE_URL, MAIL_FROM

import { HttpError, allowedOrigin, corsHeaders, json } from "./lib/http.js";
import { authRoutes } from "./routes/auth.js";
import { eventRoutes } from "./routes/events.js";
import { registrationRoutes } from "./routes/registrations.js";
import { adminRoutes } from "./routes/admin.js";
import { contentRoutes } from "./routes/content.js";
import { mediaRoutes } from "./routes/media.js";
import { membershipRoutes } from "./routes/membership.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request.headers.get("Origin"), env);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });

    try {
      for (const route of [eventRoutes, contentRoutes, mediaRoutes, authRoutes, registrationRoutes, membershipRoutes, adminRoutes]) {
        const res = await route(request, env, url, origin);
        if (res) return res;
      }
      throw new HttpError(404, "No encontrado");
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, origin);
      console.log("Error no controlado", err && err.stack || String(err));
      return json({ error: "Error interno" }, 500, origin);
    }
  },
};
