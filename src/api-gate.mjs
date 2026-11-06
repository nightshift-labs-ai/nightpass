// Minimal HTTP paywall using Nightpass (x402-style flow), against the local simulator ledger.
//   GET /v1/data            → 402 + {nonce}                        (payment required, fresh nonce)
//   GET /v1/data  with header  X-Nightpass: <nonceHex>.<nullifierHex>  → 200 if tickets[nullifier] == nonce
// In production the ledger read goes to the Midnight indexer instead of the simulator.
import http from "node:http";
import { rand32, hex } from "./simulator.mjs";

export function createGate(sim, { price = "1 credit" } = {}) {
  const pending = new Set();
  return http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (!req.url.startsWith("/v1/data")) return send(404, { error: "not found" });
    const h = req.headers["x-nightpass"];
    if (!h) { const n = hex(rand32()); pending.add(n); return send(402, { error: "payment required", scheme: "nightpass", price, nonce: n }); }
    const [nonce, nf] = String(h).split(".");
    if (!pending.has(nonce)) return send(403, { error: "unknown or used nonce" });
    const l = sim.ledger; const nfb = Uint8Array.from(Buffer.from(nf ?? "", "hex"));
    if (nfb.length !== 32 || !l.tickets.member(nfb) || hex(l.tickets.lookup(nfb)) !== nonce) return send(402, { error: "no ticket for this nonce" });
    pending.delete(nonce);
    return send(200, { ok: true, data: "paid content", payer: "unknown (anonymous credit)" });
  });
}
