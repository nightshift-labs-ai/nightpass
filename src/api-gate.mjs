// Minimal HTTP paywall using Nightpass (x402-style flow), against the local simulator ledger.
//   GET /v1/data → 402 + {nonce}   (payment required, fresh nonce, expires after ttlMs)
//   Agent picks a random 32-byte `claim` secret, redeems one credit with requestTag = sha256(nonce ‖ claim),
//   then retries with header  X-Nightpass: <nonceHex>.<nullifierHex>.<claimHex>  → 200 if tickets[nullifier] == sha256(nonce ‖ claim).
// Why the claim secret: tickets[nullifier] is PUBLIC on-chain. If the tag were just the nonce, anyone watching the chain could
// replay "<nonce>.<nullifier>" before the agent and take the response it paid for. The chain only shows the hash; the claim
// travels once, over TLS, to the API. In production the ledger read goes to the Midnight indexer instead of the simulator.
import http from "node:http";
import { createHash } from "node:crypto";
import { rand32, hex } from "./simulator.mjs";

export const requestTag = (nonceHex, claim) =>
  new Uint8Array(createHash("sha256").update(Buffer.from(nonceHex, "hex")).update(claim).digest());

// `src` is either the local simulator (has a `ledger` getter) or { getLedger: async () => ledger } reading the Midnight indexer
// (see deploy/src/gate-e2e.mjs, which runs this gate against a real chain).
export function createGate(src, { price = "1 credit", ttlMs = 120_000, maxPending = 10_000 } = {}) {
  const pending = new Map(); // nonce -> expiry (bounded: oldest dropped first)
  return http.createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (!req.url.startsWith("/v1/data")) return send(404, { error: "not found" });
    const now = Date.now();
    const h = req.headers["x-nightpass"];
    if (!h) {
      if (pending.size >= maxPending) pending.delete(pending.keys().next().value);
      const n = hex(rand32()); pending.set(n, now + ttlMs);
      return send(402, { error: "payment required", scheme: "nightpass", price, nonce: n, tag: "sha256(nonce || claim)" });
    }
    const [nonce, nf, claim] = String(h).split(".");
    const exp = pending.get(nonce);
    if (!exp || exp < now) { pending.delete(nonce); return send(403, { error: "unknown, expired or used nonce" }); }
    const l = typeof src.getLedger === "function" ? await src.getLedger() : src.ledger; const nfb = Uint8Array.from(Buffer.from(nf ?? "", "hex")); const cb = Buffer.from(claim ?? "", "hex");
    if (nfb.length !== 32 || cb.length !== 32 || !l.tickets.member(nfb) || hex(l.tickets.lookup(nfb)) !== hex(requestTag(nonce, cb)))
      return send(402, { error: "no ticket for this nonce and claim" });
    pending.delete(nonce);
    return send(200, { ok: true, data: "paid content", payer: "unknown (anonymous credit)" });
  });
}
