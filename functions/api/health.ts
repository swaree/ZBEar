const HEALTH_KEY = "health:last-check";

interface Env {
  ZBEAR_KV?: KVNamespace;
}

/**
 * GET /api/health — confirms the Pages Functions runtime and the key-value store binding work.
 * Sits behind Cloudflare Access like the rest of the site, so reaching it at all means the login passed.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.ZBEAR_KV) {
    return Response.json({ ok: false, kv: "missing ZBEAR_KV binding" }, { status: 500 });
  }
  const written = new Date().toISOString();
  await env.ZBEAR_KV.put(HEALTH_KEY, written);
  const read = await env.ZBEAR_KV.get(HEALTH_KEY);
  const kvOk = read === written;
  return Response.json({ ok: kvOk, kv: kvOk ? "ok" : "read-back mismatch", checkedAt: written }, { status: kvOk ? 200 : 500 });
};
