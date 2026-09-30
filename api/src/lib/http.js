export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function allowedOrigin(origin, env) {
  const list = (env.ALLOWED_ORIGINS || "*").split(",").map((o) => o.trim());
  if (list.includes("*")) return "*";
  return list.includes(origin) ? origin : list[0];
}

export function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

export function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Cuerpo de la solicitud inválido");
  }
}

export function str(value, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
