# kur0-scout — a verifiable opportunity research agent

> An AI agent that hunts early crypto opportunities, audits the contracts
> behind them, and — instead of asking you to trust it — publishes briefs
> whose every claim can be re-checked against a public source or an on-chain
> read, in one click.

**Live endpoint:** see the Agent Games submission (Wildcard track) — the same
HTTP API documented below. **Operator:** @kur0 · **License:** MIT ·
**Stack:** Node.js ≥ 18, zero dependencies.

---

## The problem

Free mints, airdrops, testnets and points programs are announced across
dozens of channels, and the valuable ones fill up in minutes to hours. Two
failure modes dominate for anyone trying to keep up:

1. **Too slow.** By the time a human reads five Telegram channels, two
   subreddits, three news sites and an aggregator, the free allocation is
   gone.
2. **Too trusting.** Most "opportunity alerts" — human or bot — are bare
   claims: *this mint is safe, this airdrop is real.* The reader cannot tell
   a verified contract from a copy-paste scam without redoing all the work
   themselves. Scammers exploit exactly that gap.

A research agent fixes the speed problem. It does **not** fix the trust
problem by existing — an agent's say-so is worth no more than a stranger's.
So this agent is built around a stricter rule:

> **Every claim it publishes carries the evidence needed to check it —
> a source URL, an explorer link, or the exact RPC method that produced the
> number. Anything it could not verify is labelled a *lead*, never a fact.**

## Who it helps

- **Airdrop / free-mint hunters** who need early signal without living on
  Telegram, and a first-pass risk read before they risk gas — or worse, a
  signature.
- **Agent builders** who need a research component whose output other agents
  (or judges, or users) can verify instead of ingest blindly.
- **Anyone evaluating an "agent did X" claim**: the brief format is a small
  reference pattern for checkable agent output.

## What it does

### 1. Scan (`GET /brief`)
Sweeps public, no-auth sources **in parallel** — airdrops.io, Cointelegraph
and CryptoSlate RSS, Medium's airdrop tag feed, Telegram public channel
previews, and Reddit via the Arctic Shift archive API — then extracts
*leads*: headlines matching opportunity signals (free mint, airdrop, testnet,
points program, claim live, whitelist, snapshot…). Sources that fail are
reported as failed in the brief; nothing fails silently.

### 2. Audit (`GET /audit?contract=0x…&chain=56`)
For any EVM contract behind a lead, reads the public facts:

| Fact | How |
|---|---|
| Is it a contract at all? Bytecode size | `eth_getCode` |
| Source verified? Match quality | Sourcify v2 API |
| Name / symbol / total supply | `eth_call` view getters |
| Owner present? Renounced? | `eth_call owner()` |

…then summarises them into a heuristic risk level (**LOW / MEDIUM / HIGH**)
with the reasoning spelled out, plus a `verifyItYourself` block (Sourcify
repo link, explorer link, method list). Supported chains: BSC (56), Ethereum
(1), Base (8453), Arbitrum (42161), Polygon (137).

### 3. Brief
The scan is published as structured JSON: timestamps, per-source status,
lead list with source URLs. The production deployment of this agent runs the
same loop hourly and has surfaced real, mintable opportunities within their
first hours — including free mints that were executed only after the audit
step returned a verified contract and a LOW heuristic.

## Key decisions

- **Read-only by architecture.** The agent holds no keys, has no signing
  code path, and cannot send a transaction. The worst case of a bug is a
  wrong brief — never a moved fund.
- **Zero dependencies.** Node's built-in `fetch` and `http` only. The whole
  system is three files (~450 lines) that a reviewer can actually read end
  to end — auditability is a feature, not a side effect.
- **No-auth sources only.** If a source needs an API key or an account, it
  is excluded, so anyone can reproduce a scan bit-for-bit-ish (same public
  inputs, same parser).
- **Fail soft, report honestly.** One dead source never blocks a scan, and
  the brief lists it as failed. A wrong "all good" is worse than an honest
  gap.
- **Heuristics labelled as heuristics.** "Verified source" means the
  published code matches the deployed bytecode — the agent states plainly
  that this does *not* make a project honest, and its risk note says so in
  every single audit response.

## What it cannot do

- It cannot judge a team's intentions, tokenomics, or whether a verified
  contract's *logic* is fair — it reports facts and first-pass signals;
  reading the source remains a human (or deeper-audit) job.
- Leads are headlines, not endorsements: a lead means "announced publicly,
  worth an audit", nothing more.
- Social-proof signals (follower counts, hype) are deliberately **not**
  scored — they are the easiest to fake and the least checkable.

## Where zkVerify strengthens this agent

The brief format makes claims *checkable by hand*. zkVerify makes them
**checkable by proof**:

1. **Provenance of leads (zkTLS).** Today a lead cites a URL; a sceptic
   must re-fetch it and trust their own fetch. With a zkTLS proof, the agent
   could attach a zkVerify-checkable attestation that *this HTTPS response,
   from this origin, at this time* is what the brief is based on — without
   revealing anything beyond the claim.
2. **Integrity of audits.** The audit's inputs are public RPC reads. A proof
   pipeline (e.g. a small circuit over the read transcript, or zkTLS against
   a gateway) would let the agent prove "this risk summary was computed from
   the real chain state at block N" instead of "trust my server logs".
3. **A public track record.** Anchoring brief hashes + their proofs on
   zkVerify turns "the agent says it found this early" into a timestamped,
   verifiable history — the difference between a demo and a reputation.

None of this is required for the agent to be useful today; it is the
direction that turns a research tool into a *verifiable* research tool,
which is precisely the gap zkVerify exists to close.

## Run it

```bash
node agent.mjs                 # HTTP API on $PORT (default 8080)
node agent.mjs --scan-once     # print one brief as JSON
node agent.mjs --audit 0x2170ed0880ac9a755fd29b2688956bd959f933f8 1
```

## HTTP API

| Route | Returns |
|---|---|
| `GET /` | Landing page with live examples |
| `GET /health` | `{ ok, agent, version, time }` |
| `GET /brief` | Latest scan brief (15-min cache; `?fresh=1` rescans) |
| `GET /audit?contract=0x…&chain=56` | Read-only contract audit (JSON) |

Real captured outputs live in [`examples/`](examples/): a scan brief
(7/7 sources healthy, 137 items seen, 16 leads) and an audit of a verified
BSC NFT contract (Sourcify `exact_match`, no owner, LOW heuristic).

## Provenance

This repository is the cleaned, open-source edition of the operator's
production opportunity scout, which has run hourly since early November
2026 (discovery → audit → verdict, with a strict rule that only
LOW-heuristic, gas-only, verified-contract finds are ever acted on).
Private infrastructure, credentials and wallet material are excluded by
design — the public edition needs none of them, because it never transacts.
