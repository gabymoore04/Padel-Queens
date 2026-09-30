// Envio de correos con Resend (https://resend.com).
// Sin RESEND_API_KEY no se envia nada: se escribe en el log (util en local).
export async function sendMail(env, { to, subject, html }) {
  if (env.__mailSink) env.__mailSink.push({ to, subject, html });
  if (!env.RESEND_API_KEY) {
    console.log(`[mail sin RESEND_API_KEY] a=${to} asunto=${subject}\n${html}`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to, subject, html }),
    });
    if (!res.ok) console.log("Resend error", res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.log("Resend fallo de red", String(err));
    return false;
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function emailLayout(title, bodyHtml, button) {
  const btn = button
    ? `<p style="margin:28px 0"><a href="${esc(button.url)}" style="background:#c9a13b;color:#0c0f38;padding:13px 26px;border-radius:999px;text-decoration:none;font-weight:700">${esc(button.label)}</a></p>`
    : "";
  return `<div style="background:#0c0f38;padding:32px 16px;font-family:Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#141a5c;color:#f3efe4;border-radius:14px;padding:32px">
    <p style="color:#e3c877;font-weight:800;letter-spacing:.08em;margin:0 0 18px">PADEL QUEENS</p>
    <h1 style="font-size:22px;margin:0 0 14px;color:#fff">${esc(title)}</h1>
    <div style="font-size:15px;line-height:1.6">${bodyHtml}</div>${btn}
    <p style="font-size:12px;opacity:.6;margin-top:28px">We play. We grow. We rise.</p>
  </div></div>`;
}

export { esc };
