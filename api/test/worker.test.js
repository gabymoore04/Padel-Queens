import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function fakeDb(rows) {
  return { prepare: () => ({ all: async () => ({ results: rows }) }) };
}
const env = (extra = {}) => ({ DB: fakeDb([{ id: 1, title: "Crown Cup" }]), ADMIN_CODE: "abc", TOKEN_SECRET: "s3cret", ALLOWED_ORIGINS: "https://padelqueensclub.com", ...extra });

test("GET /api/events devuelve eventos con CORS del origen permitido", async () => {
  const res = await worker.fetch(new Request("https://api/api/events", { headers: { Origin: "https://padelqueensclub.com" } }), env());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://padelqueensclub.com");
  assert.equal((await res.json())[0].title, "Crown Cup");
});

test("login incorrecto da 401 y correcto da token que abre rutas admin", async () => {
  const bad = await worker.fetch(new Request("https://api/api/admin/login", { method: "POST", body: JSON.stringify({ code: "x" }) }), env());
  assert.equal(bad.status, 401);
  const ok = await worker.fetch(new Request("https://api/api/admin/login", { method: "POST", body: JSON.stringify({ code: "abc" }) }), env());
  const { token } = await ok.json();
  assert.ok(token);
  const noAuth = await worker.fetch(new Request("https://api/api/admin/events/1", { method: "DELETE" }), env());
  assert.equal(noAuth.status, 401);
});
