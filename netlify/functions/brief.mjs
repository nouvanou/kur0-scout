// Netlify Function: GET /brief — one full scan, returned as a brief.
import { scanSources } from "../../lib/sources.mjs";

export default async () => {
  const scan = await scanSources();
  const brief = {
    agent: "kur0-scout",
    version: "1.0.0",
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
  return new Response(JSON.stringify(brief, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
