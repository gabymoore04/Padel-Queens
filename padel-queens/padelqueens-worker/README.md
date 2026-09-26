# Padel Queens — Events API (Cloudflare Worker)

## 1. Requisitos
- Node.js instalado
- `npm install -g wrangler`
- `wrangler login` (te abre el navegador para autorizar tu cuenta de Cloudflare)

## 2. Configurar los secretos (tu "código de administrador")
Desde esta carpeta:

    wrangler secret put ADMIN_CODE
    # te va a pedir que escribas el código que usarás para entrar al panel admin

    wrangler secret put TOKEN_SECRET
    # pega aquí una cadena larga y aleatoria, por ejemplo la que genera:
    # openssl rand -hex 32

## 3. Desplegar el Worker

    wrangler deploy

Esto te da una URL tipo `padelqueens-events-api.<tu-cuenta>.workers.dev` — pruébala:
abre `https://esa-url/api/events` en el navegador, deberías ver tus 3 eventos en JSON.

## 4. Conectar tu dominio propio
Ya dejé la ruta lista en `wrangler.toml` apuntando a:

    api.padelqueensclub.com

Como padelqueensclub.com ya está en Cloudflare, en cuanto corras `wrangler deploy`
el subdominio queda activo solo (Cloudflare crea el DNS necesario automáticamente
al usar `custom_domain = true`).

## 5. Ya está
Tu web (el archivo padel-queens.html) ya está apuntando a
`https://api.padelqueensclub.com` — no tienes que tocar nada ahí, ya está
configurado con tu dominio real.
