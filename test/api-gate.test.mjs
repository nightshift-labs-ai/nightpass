import { test } from "node:test";
import assert from "node:assert/strict";
import { NightpassSim, AgentWallet, hex } from "../src/simulator.mjs";
import { createGate } from "../src/api-gate.mjs";

test("HTTP gate: 402 → anonymous redeem → 200; replayed header → 403", async () => {
  const sim = await NightpassSim.deploy();
  const agent = new AgentWallet();
  await sim.issue(agent.newBundle(2).commitment);
  const srv = createGate(sim).listen(0); const url = `http://127.0.0.1:${srv.address().port}/v1/data`;
  try {
    const r1 = await fetch(url); assert.equal(r1.status, 402);
    const { nonce } = await r1.json();
    const nf = await agent.pay(sim, Uint8Array.from(Buffer.from(nonce, "hex")));
    const hdr = { "x-nightpass": `${nonce}.${hex(nf)}` };
    const r2 = await fetch(url, { headers: hdr }); assert.equal(r2.status, 200);
    const r3 = await fetch(url, { headers: hdr }); assert.equal(r3.status, 403);
    const r4 = await fetch(url); const n2 = (await r4.json()).nonce;
    const r5 = await fetch(url, { headers: { "x-nightpass": `${n2}.${hex(nf)}` } }); assert.equal(r5.status, 402, "old nullifier can't pay a new nonce");
  } finally { srv.close(); }
});
