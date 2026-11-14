// Netlify Function: GET /audit?contract=0x…&chain=56
import { auditContract, CHAINS } from "../../lib/audit.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const contract = url.searchParams.get("contract");
  const chain = Number(url.searchParams.get("chain") ?? 56);
  const json = (status, body) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  if (!contract) return json(400, { ok: false, error: "Missing ?contract=0x…", supportedChains: Object.keys(CHAINS) });
  const out = await auditContract(contract, chain);
  return json(out.ok ? 200 : 400, out);
};
