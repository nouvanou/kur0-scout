// Read-only contract audit core.
//
// The agent NEVER signs and NEVER sends a transaction. An audit is a bundle
// of public facts — Sourcify verification status plus eth_call / eth_getCode
// reads — each returned with the URL or RPC method it came from, so any
// reviewer can reproduce every number in seconds.
//
// The risk level is a heuristic summary of those facts, labelled as such.
// "Verified source" proves the published code matches the deployed bytecode;
// it does not prove a project is honest. The agent says exactly that.

export const CHAINS = {
  56:    { name: "BSC",      rpcs: ["https://bsc-dataseed.binance.org/", "https://1rpc.io/bnb"], explorer: "https://bscscan.com" },
  1:     { name: "Ethereum", rpcs: ["https://ethereum.publicnode.com"],                          explorer: "https://etherscan.io" },
  8453:  { name: "Base",     rpcs: ["https://base.publicnode.com"],                              explorer: "https://basescan.org" },
  42161: { name: "Arbitrum", rpcs: ["https://arb1.arbitrum.io/rpc"],                             explorer: "https://arbiscan.io" },
  137:   { name: "Polygon",  rpcs: ["https://polygon-bor.publicnode.com"],                       explorer: "https://polygonscan.com" },
};

const UA = { "User-Agent": "kur0-scout/1.0 (+research agent; read-only)" };
const ZERO = "0x0000000000000000000000000000000000000000";

async function rpc(chain, method, params) {
  let lastErr;
  for (const url of CHAINS[chain].rpcs) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 10000);
      const r = await fetch(url, {
        method: "POST",
        headers: { ...UA, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctl.signal,
      });
      clearTimeout(t);
      const j = await r.json();
      if (j.error) throw new Error(j.error.message ?? "rpc error");
      return j.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("all RPCs failed");
}

const call = (chain, to, data) =>
  rpc(chain, "eth_call", [{ to, data }, "latest"]).catch(() => null);

function decodeString(hex) {
  if (!hex || hex === "0x") return null;
  try {
    const buf = Buffer.from(hex.slice(2), "hex");
    // ABI dynamic string: offset(32) + length(32) + data
    if (buf.length >= 64) {
      const len = Number(BigInt("0x" + buf.subarray(32, 64).toString("hex")));
      if (len > 0 && len <= 512) return buf.subarray(64, 64 + len).toString("utf8");
    }
    return buf.toString("utf8").replace(/\0/g, "").trim() || null;
  } catch { return null; }
}
const decodeUint = (hex) => (hex && hex !== "0x" ? BigInt(hex).toString() : null);
const decodeAddr = (hex) =>
  hex && hex.length >= 66 ? "0x" + hex.slice(-40) : null;

async function sourcify(chain, address) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(`https://sourcify.dev/server/v2/contract/${chain}/${address}`, {
      headers: UA, signal: ctl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return { checked: true, match: null, note: `Sourcify HTTP ${r.status}` };
    const j = await r.json();
    return { checked: true, match: j.match ?? null, verified: Boolean(j.match) };
  } catch (e) {
    return { checked: false, match: null, note: String(e?.message ?? e) };
  }
}

export async function auditContract(address, chainId = 56) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) {
    return { ok: false, error: "Invalid EVM address. Expected 0x + 40 hex characters." };
  }
  const chain = CHAINS[chainId];
  if (!chain) {
    return { ok: false, error: `Unsupported chainId ${chainId}. Supported: ${Object.keys(CHAINS).join(", ")}.` };
  }
  const addr = address.toLowerCase();
  const [src, code, name, symbol, totalSupply, owner] = await Promise.all([
    sourcify(chainId, addr),
    rpc(chainId, "eth_getCode", [addr, "latest"]).catch(() => null),
    call(chainId, addr, "0x06fdde03"), // name()
    call(chainId, addr, "0x95d89b41"), // symbol()
    call(chainId, addr, "0x18160ddd"), // totalSupply()
    call(chainId, addr, "0x8da5cb5b"), // owner()
  ]);

  const ownerAddr = decodeAddr(owner);
  const facts = {
    isContract: Boolean(code && code !== "0x"),
    bytecodeBytes: code && code !== "0x" ? (code.length - 2) / 2 : 0,
    sourcifyMatch: src.match,
    name: decodeString(name),
    symbol: decodeString(symbol),
    totalSupplyRaw: decodeUint(totalSupply),
    owner: ownerAddr,
    ownerRenounced: ownerAddr === ZERO,
  };

  const signals = [];
  if (!facts.isContract) signals.push({ level: "high", text: "Address holds no contract bytecode on this chain." });
  if (src.checked && !src.verified) signals.push({ level: "high", text: "Source code is NOT verified on Sourcify — behaviour cannot be inspected." });
  if (src.verified) signals.push({ level: "ok", text: `Source verified on Sourcify (${src.match} match) — published code matches deployed bytecode.` });
  if (facts.ownerRenounced) signals.push({ level: "ok", text: "owner() is the zero address — ownership renounced, no admin key." });
  else if (ownerAddr) signals.push({ level: "medium", text: `owner() is ${ownerAddr} — an admin key exists; what it can do depends on the verified source.` });
  else if (facts.isContract) signals.push({ level: "ok", text: "No owner() exposed — no obvious admin entry point via the standard getter." });
  if (!src.checked) signals.push({ level: "medium", text: `Sourcify check failed (${src.note}) — verification status unknown, treat as unverified.` });

  const risk = !facts.isContract || (src.checked && !src.verified)
    ? "HIGH"
    : signals.some((s) => s.level === "medium") ? "MEDIUM" : "LOW";

  return {
    ok: true,
    agent: "kur0-scout",
    checkedAt: new Date().toISOString(),
    address: addr,
    chain: { id: chainId, name: chain.name },
    facts,
    signals,
    riskLevel: risk,
    riskNote: "Heuristic summary of the facts above — not a guarantee. Verified code can still belong to a bad project; always read the source.",
    verifyItYourself: {
      sourcify: `https://repo.sourcify.dev/contracts/full_match/${chainId}/${addr}/`,
      explorer: `${chain.explorer}/address/${addr}`,
      methods: ["eth_getCode", "eth_call name()/symbol()/totalSupply()/owner()", "Sourcify v2 API"],
    },
  };
}
