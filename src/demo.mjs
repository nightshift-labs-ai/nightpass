// End-to-end story in the local simulator:
// an AI agent buys 3 API calls, then pays each call anonymously; the API checks the ticket on the ledger.
import { NightpassSim, AgentWallet, rand32, hex } from "./simulator.mjs";

const short = (u8) => hex(u8).slice(0, 12) + "…";
const sim = await NightpassSim.deploy();
console.log("1) Operator deployed Nightpass. Public operator key:", short(sim.ledger.operator));

// --- the "API server" side: issues a nonce per request and checks the ledger before serving
const api = {
  pending: new Map(),
  challenge() { const n = rand32(); this.pending.set(hex(n), true); return n; },
  serve(nonce, nullifier) {
    const l = sim.ledger;
    if (!this.pending.has(hex(nonce))) return "403 unknown request";
    if (!l.tickets.member(nullifier) || hex(l.tickets.lookup(nullifier)) !== hex(nonce)) return "402 payment required";
    this.pending.delete(hex(nonce));
    return "200 OK (paid by an anonymous credit)";
  },
};

const agent = new AgentWallet();
const req = agent.newBundle(3), { commitment } = req;
await sim.issue(req); // agent paid for 3 calls; it sends only ownerTag = H(secret), the circuit builds the commitment
console.log("2) Agent bought a 3-call bundle. On-chain the operator sees only commitment", short(commitment));

for (let i = 1; i <= 4; i++) {
  const nonce = api.challenge();
  let nf;
  try { nf = await agent.pay(sim, nonce); } catch (e) { console.log(`   call ${i}: agent cannot pay → ${e.message}`); break; }
  console.log(`   call ${i}: ZK redeem → nullifier ${short(nf)} → API says: ${api.serve(nonce, nf)}`);
}
const l = sim.ledger;
console.log(`3) Ledger: ${l.bundlesIssued} bundle(s) issued, ${l.creditsRedeemed} credit(s) redeemed, ${l.spent.size()} nullifiers.`);
console.log("   No redemption reveals which bundle (or buyer) paid; replaying a nullifier fails in the circuit.");
