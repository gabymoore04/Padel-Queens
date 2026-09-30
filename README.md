# Padel Queens

- `web/`: sitio estático (Cloudflare Workers static assets)
- `api/`: Worker + base D1 `padelqueens-events`
- `PLAN-padel-queens.md`: plan por fases

## Comandos
    npm install
    npm test
    npm run db:migrate:local      # migraciones en D1 local
    npm run dev:api               # API en http://localhost:8787
    npm run deploy:api            # despliega el Worker
    npm run db:migrate:prod       # aplica migraciones a la base real
    npm run deploy:web            # despliega el sitio

Por ahora no se usa dominio propio: todo corre en URLs `*.workers.dev`.
La web lee la URL del API en `web/config.js`.

## Secretos (nunca en git)
    cd api
    npx wrangler secret put ADMIN_CODE
    npx wrangler secret put TOKEN_SECRET     # openssl rand -hex 32
