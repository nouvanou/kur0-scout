// Netlify Function: GET /health
export default async () =>
  new Response(
    JSON.stringify({ ok: true, agent: "kur0-scout", version: "1.0.0", time: new Date().toISOString() }, null, 2),
    { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }
  );
