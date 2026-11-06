import { test } from "node:test";
import assert from "node:assert/strict";
import { PunchcardSim, AgentWallet, hex, rand32 } from "../src/simulator.mjs";
import { createGate, requestTag } from "../src/api-gate.mjs";

async function withGate(fn, opts) {
  const sim = await PunchcardSim.deploy();
  const agent = new AgentWallet();
  await sim.issue(agent.newBundle(3));
  const src = opts?.slowLedger ? { getLedger: () => new Promise((r) => setTimeout(() => r(sim.ledger), opts.slowLedger)) } : sim;
  const srv = createGate(src, opts).listen(0); const url = `http://127.0.0.1:${srv.address().port}/v1/data`;
  try { await fn({ sim, agent, url }); } finally { srv.close(); }
}
const paidCall = async (agent, sim, url) => {
  const { nonce } = await (await fetch(url)).json();
  const claim = rand32();
  const nf = await agent.pay(sim, requestTag(nonce, claim));
  return { nonce, nf, claim, hdr: { "x-punchcard": `${nonce}.${hex(nf)}.${hex(claim)}` } };
};

test("HTTP gate: 402 → anonymous redeem → 200; replayed header → 403; old nullifier can't pay a new nonce", () => withGate(async ({ sim, agent, url }) => {
  assert.equal((await fetch(url)).status, 402);
  const { nf, claim, hdr } = await paidCall(agent, sim, url);
  assert.equal((await fetch(url, { headers: hdr })).status, 200);
  assert.equal((await fetch(url, { headers: hdr })).status, 403);
  const { nonce: n2 } = await (await fetch(url)).json();
  assert.equal((await fetch(url, { headers: { "x-punchcard": `${n2}.${hex(nf)}.${hex(claim)}` } })).status, 402);
}));

test("HTTP gate: a chain watcher cannot front-run the paid call (it sees only sha256(nonce‖claim))", () => withGate(async ({ sim, agent, url }) => {
  const { nonce, nf, hdr } = await paidCall(agent, sim, url);
  // attacker reads the public ledger: nullifier + ticket hash, and knows the nonce (e.g. sniffed 402); it lacks the claim
  const ticket = sim.ledger.tickets.lookup(nf);
  for (const guess of [ticket, new Uint8Array(32), rand32()])
    assert.equal((await fetch(url, { headers: { "x-punchcard": `${nonce}.${hex(nf)}.${hex(guess)}` } })).status, 402);
  assert.equal((await fetch(url, { headers: hdr })).status, 200, "the real agent still gets its response");
}));

test("HTTP gate: nonces expire", () => withGate(async ({ sim, agent, url }) => {
  const { hdr } = await paidCall(agent, sim, url);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal((await fetch(url, { headers: hdr })).status, 403);
}, { ttlMs: 10 }));

test("HTTP gate: two concurrent copies of one paid header are served once", () => withGate(async ({ sim, agent, url }) => {
  const { hdr } = await paidCall(agent, sim, url);
  const codes = (await Promise.all([1, 2, 3].map(() => fetch(url, { headers: hdr })))).map((r) => r.status).sort();
  assert.equal(codes.filter((c) => c === 200).length, 1, `codes ${codes}`);
}, { slowLedger: 30 }));

test("HTTP gate: a flood of unpaid requests cannot evict a nonce the agent is paying for; forged nonces are refused", () => withGate(async ({ sim, agent, url }) => {
  const { nonce } = await (await fetch(url)).json();
  await Promise.all(Array.from({ length: 300 }, () => fetch(url).then((r) => r.arrayBuffer())));
  const claim = rand32(); const nf = await agent.pay(sim, requestTag(nonce, claim));
  assert.equal((await fetch(url, { headers: { "x-punchcard": `${nonce}.${hex(nf)}.${hex(claim)}` } })).status, 200);
  const forged = "ff".repeat(32), c2 = rand32(); const nf2 = await agent.pay(sim, requestTag(forged, c2));
  assert.equal((await fetch(url, { headers: { "x-punchcard": `${forged}.${hex(nf2)}.${hex(c2)}` } })).status, 403);
}));
