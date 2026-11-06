import { test } from "node:test";
import assert from "node:assert/strict";
import { NightpassSim, AgentWallet, tag, hex, rand32, pureCircuits } from "../src/simulator.mjs";

const rejects = (p, re) => assert.rejects(p, (e) => re.test(String(e.message ?? e)));

test("deploy records only the operator's derived public key", async () => {
  const sk = rand32();
  const sim = await NightpassSim.deploy(sk);
  assert.equal(hex(sim.ledger.operator), hex(pureCircuits.publicKey(sk)));
  assert.notEqual(hex(sim.ledger.operator), hex(sk));
  assert.equal(sim.ledger.bundlesIssued, 0n);
});

test("only the operator can issue bundles", async () => {
  const sim = await NightpassSim.deploy();
  const { commitment } = new AgentWallet().newBundle(5);
  await rejects(sim.issue(commitment, rand32()), /Only the operator/);
  await sim.issue(commitment);
  assert.equal(sim.ledger.bundlesIssued, 1n);
});

test("an agent can spend exactly N credits from an N-use bundle", async () => {
  const sim = await NightpassSim.deploy();
  const w = new AgentWallet();
  await sim.issue(w.newBundle(3).commitment);
  for (let i = 0; i < 3; i++) await w.pay(sim, tag(`req-${i}`));
  assert.equal(sim.ledger.creditsRedeemed, 3n);
  assert.equal(w.remaining(), 0n);
  // forcing a 4th use (index 3) must fail inside the circuit
  const b = w.bundles[0].bundle;
  await rejects(sim.call("redeem", { secret: new Uint8Array(32), spend: { bundle: b, index: 3n } }, tag("req-x")), /out of range/);
});

test("double spend of the same credit is rejected", async () => {
  const sim = await NightpassSim.deploy();
  const w = new AgentWallet();
  await sim.issue(w.newBundle(2).commitment);
  const spend = { bundle: w.bundles[0].bundle, index: 0n };
  await sim.call("redeem", { secret: new Uint8Array(32), spend }, tag("a"));
  await rejects(sim.call("redeem", { secret: new Uint8Array(32), spend }, tag("b")), /already spent/);
  assert.equal(sim.ledger.creditsRedeemed, 1n);
});

test("a bundle that was never issued (unpaid) cannot be spent", async () => {
  const sim = await NightpassSim.deploy();
  await sim.issue(new AgentWallet().newBundle(1).commitment); // someone else's bundle
  const thief = new AgentWallet(); thief.newBundle(10);       // never paid / issued
  await assert.rejects(thief.pay(sim, tag("free-lunch")));
  assert.equal(sim.ledger.creditsRedeemed, 0n);
});

test("inflating the use count of a real bundle fails (commitment binds N)", async () => {
  const sim = await NightpassSim.deploy();
  const w = new AgentWallet();
  await sim.issue(w.newBundle(1).commitment);
  const real = w.bundles[0].bundle;
  const path = sim.ledger.bundles.findPathForLeaf(pureCircuits.bundleCommitment(real));
  // custom witnesses: claim the same secret with uses=100, reusing the real path
  const { Contract } = await import("../contract/managed/contract/index.js");
  const evil = new Contract({
    localSecret: ({ privateState }) => [privateState, new Uint8Array(32)],
    bundle: ({ privateState }) => [privateState, { secret: real.secret, uses: 100n }],
    bundlePath: ({ privateState }) => [privateState, path],
    useIndex: ({ privateState }) => [privateState, 50n],
  });
  await rejects((async () => evil.impureCircuits.redeem(sim.ctx("redeem", {}), tag("x")))(), /does not belong/);
});

test("redemptions are unlinkable: on-chain data never contains the bundle commitment", async () => {
  const sim = await NightpassSim.deploy();
  const alice = new AgentWallet(), bob = new AgentWallet();
  const ca = alice.newBundle(2).commitment, cb = bob.newBundle(2).commitment;
  await sim.issue(ca); await sim.issue(cb);
  const nfs = [await alice.pay(sim, tag("a1")), await bob.pay(sim, tag("b1")), await alice.pay(sim, tag("a2"))];
  const seen = new Set(nfs.map(hex));
  assert.equal(seen.size, 3, "every use has a fresh nullifier");
  for (const nf of nfs) {
    assert.notEqual(hex(nf), hex(ca)); assert.notEqual(hex(nf), hex(cb));
  }
  // the public spent-set and ticket map hold nullifiers only
  const spent = [...sim.ledger.spent].map(hex).sort();
  assert.deepEqual(spent, [...seen].sort());
  for (const [nf, t] of sim.ledger.tickets) assert.ok(seen.has(hex(nf)) && t.length === 32);
});

test("the API operator can verify which request a nullifier paid for", async () => {
  const sim = await NightpassSim.deploy();
  const w = new AgentWallet();
  await sim.issue(w.newBundle(1).commitment);
  const reqTag = rand32(); // server-chosen nonce for this API call
  const nf = await w.pay(sim, reqTag);
  assert.ok(sim.ledger.tickets.member(nf));
  assert.equal(hex(sim.ledger.tickets.lookup(nf)), hex(reqTag));
});

test("bundles issued later do not break proofs for older bundles (historic roots)", async () => {
  const sim = await NightpassSim.deploy();
  const w = new AgentWallet();
  await sim.issue(w.newBundle(2).commitment);
  for (let i = 0; i < 5; i++) await sim.issue(new AgentWallet().newBundle(1).commitment);
  await w.pay(sim, tag("late"));
  assert.equal(sim.ledger.creditsRedeemed, 1n);
  assert.equal(sim.ledger.bundlesIssued, 6n);
});

test("a forged Merkle path (fake tree) is rejected by the circuit", async () => {
  const sim = await NightpassSim.deploy();
  const honest = new AgentWallet();
  await sim.issue(honest.newBundle(1).commitment);
  const realPath = sim.ledger.bundles.findPathForLeaf(pureCircuits.bundleCommitment(honest.bundles[0].bundle));
  const fake = { secret: rand32(), uses: 5n };
  const forged = { leaf: pureCircuits.bundleCommitment(fake), path: realPath.path };
  const { Contract } = await import("../contract/managed/contract/index.js");
  const evil = new Contract({
    localSecret: ({ privateState }) => [privateState, new Uint8Array(32)],
    bundle: ({ privateState }) => [privateState, fake],
    bundlePath: ({ privateState }) => [privateState, forged],
    useIndex: ({ privateState }) => [privateState, 0n],
  });
  await rejects((async () => evil.impureCircuits.redeem(sim.ctx("redeem", {}), tag("x")))(), /not in the tree/);
});

test("self-serve buy(): agent pays in-contract, no operator step, credits spendable", async () => {
  const sim = await NightpassSim.deploy(rand32(), 250n);
  const w = new AgentWallet();
  await w.buy(sim, 3);
  assert.equal(sim.ledger.bundlesIssued, 1n);
  assert.equal(sim.ledger.pricePerCredit, 250n);
  for (let i = 0; i < 3; i++) await w.pay(sim, tag(`b${i}`));
  assert.equal(sim.ledger.creditsRedeemed, 3n);
});

test("buy() rejects a commitment that does not match the paid bundle size", async () => {
  const sim = await NightpassSim.deploy();
  const w = new AgentWallet();
  const { bundle } = w.newBundle(100);                       // commitment for 100 uses …
  const small = pureCircuits.bundleCommitment(bundle);
  await rejects((async () => sim.call("buy", { secret: new Uint8Array(32), spend: { bundle, index: 0n } }, small, 1n))(), /does not match/); // … paying for 1
  assert.equal(sim.ledger.bundlesIssued, 0n);
});

test("only the operator can withdraw", async () => {
  const sim = await NightpassSim.deploy();
  const to = { bytes: rand32() };
  await rejects((async () => sim.call("withdraw", { secret: rand32() }, 1n, to))(), /Only the operator/);
});
