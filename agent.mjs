// kur0-scout — a verifiable opportunity research agent.
//
// What it does
//   1. SCAN: sweeps public, no-auth sources (airdrop aggregators, crypto news
//      RSS, Telegram public previews, Reddit archive, Medium) in parallel and
//      extracts early opportunity leads: free mints, airdrops, testnets,
//      points programs.
//   2. AUDIT: for any EVM contract behind a lead, reads the public facts —
//      Sourcify verification, bytecode, name/symbol/supply, owner — and
//      returns them with a heuristic risk level and the exact URLs/methods a
//      reviewer can use to reproduce every number.
//   3. BRIEF: publishes the scan as a structured brief. Every claim in the
//      brief carries its source URL; anything the agent could not verify is
//      labelled a lead, never a fact.
//
// What it never does: hold keys, sign, transact, or ask for yours.
// It is a research instrument. Its output is checkable, not trustworthy —
// that distinction is the whole point, and it is where zkVerify fits (see
// README.md, "Where zkVerify strengthens this agent").
//
// HTTP API
//   GET /              landing page + live status
//   GET /health        { ok, agent, version, time }
//   GET /brief         latest scan brief (cached; ?fresh=1 forces a rescan)
//   GET /audit?contract=0x…&chain=56   read-only contract audit (JSON)
//
// CLI
//   node agent.mjs --scan-once
//   node agent.mjs --audit 0x… [chainId]

import http from "node:http";
import { scanSources } from "./lib/sources.mjs";
import { auditContract, CHAINS } from "./lib/audit.mjs";

const VERSION = "1.0.0";
let briefCache = null;
let briefAt = 0;
const BRIEF_TTL_MS = 15 * 60 * 1000;

async function getBrief(fresh = false) {
  if (!fresh && briefCache && Date.now() - briefAt < BRIEF_TTL_MS) return briefCache;
  const scan = await scanSources();
  briefCache = {
    agent: "kur0-scout",
    version: VERSION,
    kind: "opportunity-scan-brief",
    generatedAt: scan.scannedAt,
    summary: {
      sourcesOk: scan.sourceStatus.filter((s) => s.ok).length,
      sourcesTotal: scan.sourceStatus.length,
      itemsSeen: scan.totalItems,
      leadsFound: scan.leads.length,
    },
    sourceStatus: scan.sourceStatus,
    leads: scan.leads.slice(0, 50),
    note: "Leads are unverified headlines from public sources. Verify a lead's contract with /audit before acting on it.",
  };
  briefAt = Date.now();
  return briefCache;
}

const landing = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>kur0-scout — verifiable opportunity research agent</title>
<style>body{font-family:ui-monospace,Menlo,Consolas,monospace;background:#0b0e13;color:#dbe4f0;margin:0;padding:2.5rem 1.25rem;line-height:1.55}
main{max-width:760px;margin:0 auto}h1{font-size:1.6rem;margin:.2rem 0}a{color:#7dd3fc}code{background:#161c26;padding:.1rem .35rem;border-radius:4px}
.card{border:1px solid #26303f;border-radius:10px;padding:1rem 1.2rem;margin:1rem 0;background:#10151d}.dim{color:#8fa1b8}</style></head>
<body><main>
<p class="dim">AI AGENT · READ-ONLY · NO KEYS · NO SIGNING</p>
<h1>kur0-scout</h1>
<p>An opportunity research agent. It sweeps public sources for early crypto
opportunities — free mints, airdrops, testnets, points programs — audits the
contracts behind them, and publishes briefs whose every claim links back to a
public source or an on-chain read you can reproduce yourself.</p>
<div class="card"><b>Try it live</b>
<p><code>GET <a href="/brief">/brief</a></code> — the latest scan brief (sources, leads, timestamps)</p>
<p><code>GET <a href="/audit?contract=0x2170ed0880ac9a755fd29b2688956bd959f933f8&chain=1">/audit?contract=0x…&amp;chain=1</a></code> — a read-only audit of any EVM contract (BSC 56, Ethereum 1, Base 8453, Arbitrum 42161, Polygon 137)</p>
<p><code>GET <a href="/health">/health</a></code> — liveness</p></div>
<div class="card"><b>Why verifiable?</b>
<p>An agent that says "this mint is safe" is asking for trust. This one shows
its work instead: Sourcify match status, raw on-chain reads, and the exact
methods used — so the claim can be checked, not believed. The natural next
step is a zkVerify proof over the agent's inputs (e.g. a zkTLS proof that a
lead really came from the source it cites). See the README in the repository.</p></div>
<p class="dim">Built for the zkVerify Agent Games — Wildcard track. Operator handle: @kur0.</p>
</main></body></html>`;

function send(res, status, body, type = "application/json") {
  const data = type === "application/json" ? JSON.stringify(body, null, 2) : body;
  res.writeHead(status, { "Content-Type": type + "; charset=utf-8", "Cache-Control": "no-store" });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/") return send(res, 200, landing(), "text/html");
    if (url.pathname === "/health")
      return send(res, 200, { ok: true, agent: "kur0-scout", version: VERSION, time: new Date().toISOString() });
    if (url.pathname === "/brief")
      return send(res, 200, await getBrief(url.searchParams.get("fresh") === "1"));
    if (url.pathname === "/audit") {
      const contract = url.searchParams.get("contract");
      const chain = Number(url.searchParams.get("chain") ?? 56);
      if (!contract) return send(res, 400, { ok: false, error: "Missing ?contract=0x…", supportedChains: Object.keys(CHAINS) });
      const out = await auditContract(contract, chain);
      return send(res, out.ok ? 200 : 400, out);
    }
    return send(res, 404, { ok: false, error: "Not found. Try /, /brief, /audit?contract=0x…&chain=56, /health" });
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e?.message ?? e) });
  }
});

// --- CLI mode ---------------------------------------------------------------
const args = process.argv.slice(2);
if (args[0] === "--scan-once") {
  console.log(JSON.stringify(await getBrief(true), null, 2));
  process.exit(0);
}
if (args[0] === "--audit") {
  console.log(JSON.stringify(await auditContract(args[1], Number(args[2] ?? 56)), null, 2));
  process.exit(0);
}

const PORT = Number(process.env.PORT ?? 8080);
server.listen(PORT, () => console.log(`kur0-scout listening on :${PORT}`));
