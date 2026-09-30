# Padel Queens

- `web/`: sitio estático (Cloudflare Workers static assets): inicio, `cuenta.html`, `evento.html`, `admin.html`
- `api/`: Worker + base D1 `padelqueens-events`
- `PLAN-padel-queens.md`: plan por fases

## Comandos
    npm install
    npm test                      # pruebas de extremo a extremo con D1 local
    npm run db:migrate:local
    npm run dev:api               # API en http://localhost:8787
    npm run db:migrate:prod       # aplica migraciones a la base real
    npm run deploy:api
    npm run deploy:web

Por ahora no se usa dominio propio: todo corre en URLs `*.workers.dev`.
La web lee la URL del API en `web/config.js`.

## Secretos (nunca en git)
    cd api
    npx wrangler secret put TOKEN_SECRET     # openssl rand -hex 32
    npx wrangler secret put ADMIN_EMAILS     # correos admin separados por coma
    npx wrangler secret put RESEND_API_KEY   # clave de resend.com

Variables en `api/wrangler.toml`: `SITE_URL` (URL de la web, para los enlaces de los correos),
`MAIL_FROM`, `ALLOWED_ORIGINS`.

## Como funciona el cobro
- El precio del evento es por jugadora. Cada evento tiene dos links de CardNet:
  uno para "mi parte" (precio) y otro para "las dos" (precio x 2).
- Las jugadoras inician el pago desde su cuenta; la administradora lo marca como pagado en `admin.html`.
- Las administradoras son las cuentas con correo verificado que estén en `ADMIN_EMAILS`.
