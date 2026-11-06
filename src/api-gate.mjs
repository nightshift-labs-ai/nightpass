// Minimal HTTP paywall using Punchcard (x402-style flow), against the local simulator ledger.
//   GET /v1/data → 402 + {nonce}   (payment required, fresh nonce, expires after ttlMs)
//   Agent picks a random 32-byte `claim` secret, redeems one credit with requestTag = sha256(nonce ‖ claim),
//   then retries with header  X-Punchcard: <nonceHex>.<nullifierHex>.<claimHex>  → 200 if tickets[nullifier] == sha256(nonce ‖ claim).
// Why the claim secret: tickets[nullifier] is PUBLIC on-chain. If the tag were just the nonce, anyone watching the chain could
// replay "<nonce>.<nullifier>" before the agent and take the response it paid for. The chain only shows the hash; the claim
// travels once, over TLS, to the API. In production the ledger read goes to the Midnight indexer instead of the simulator.
import http from "node:http";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hex } from "./simulator.mjs";

export const requestTag = (nonceHex, claim) =>
  new Uint8Array(createHash("sha256").update(Buffer.from(nonceHex, "hex")).update(claim).digest());

// Nonces are STATELESS: nonce = expiry(8 bytes) ‖ random(8) ‖ HMAC(serverKey, expiry ‖ random)[0..16] (32 bytes).
// The server stores nothing per 402, so a flood of unpaid requests cannot evict a nonce an agent is paying for.
// Only nonces that were actually served are remembered (in `used`, until they expire) to stop replays, and a nonce
// being checked is locked in `inflight`, so two concurrent copies of one header can never both be served.
// `src` is either the local simulator (has a `ledger` getter) or { getLedger: async () => ledger } reading the Midnight indexer
// (see deploy/src/gate-e2e.mjs, which runs this gate against a real chain).
export function createGate(src, { price = "1 credit", ttlMs = 600_000, key = randomBytes(32) } = {}) {
  const used = new Map(); // served nonce -> expiry
  const inflight = new Set();
  const mac = (b) => createHmac("sha256", key).update(b).digest().subarray(0, 16);
  const newNonce = (now) => { const b = Buffer.alloc(16); b.writeBigUInt64BE(BigInt(now + ttlMs)); randomBytes(8).copy(b, 8);
    return Buffer.concat([b, mac(b)]).toString("hex"); };
  const nonceExpiry = (n) => { const b = Buffer.from(/^[0-9a-f]{64}$/.test(n ?? "") ? n : "", "hex"); if (b.length !== 32) return 0;
    return timingSafeEqual(b.subarray(16), mac(b.subarray(0, 16))) ? Number(b.readBigUInt64BE(0)) : 0; };
  const prune = (now) => { for (const [n, e] of used) if (e < now) used.delete(n); };
  return http.createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (!req.url.startsWith("/v1/data")) return send(404, { error: "not found" });
    const now = Date.now();
    const h = req.headers["x-punchcard"];
    if (!h) return send(402, { error: "payment required", scheme: "punchcard", price, nonce: newNonce(now), expiresInMs: ttlMs, tag: "sha256(nonce || claim)" });
    const [nonce, nf, claim] = String(h).split(".");
    const exp = nonceExpiry(nonce);
    if (!exp || exp < now || used.has(nonce)) return send(403, { error: "unknown, expired or used nonce" });
    if (inflight.has(nonce)) return send(409, { error: "this nonce is being checked by another request; retry" });
    inflight.add(nonce);
    try {
      const l = typeof src.getLedger === "function" ? await src.getLedger() : src.ledger;
      const nfb = Uint8Array.from(Buffer.from(nf ?? "", "hex")); const cb = Buffer.from(claim ?? "", "hex");
      if (nfb.length !== 32 || cb.length !== 32 || !l.tickets.member(nfb) || hex(l.tickets.lookup(nfb)) !== hex(requestTag(nonce, cb)))
        return send(402, { error: "no ticket for this nonce and claim" });
      prune(now); used.set(nonce, exp);
      return send(200, { ok: true, data: "paid content", payer: "unknown (anonymous credit)" });
    } finally { inflight.delete(nonce); }
  });
}
