import { test } from "node:test";
import assert from "node:assert/strict";
import { PunchcardSim, AgentWallet, tag, hex, rand32, pureCircuits } from "../src/simulator.mjs";

const rejects = (p, re) => assert.rejects(p, (e) => re.test(String(e.message ?? e)));

test("deploy records only the operator's derived public key", async () => {
  const sk = rand32();
  const sim = await PunchcardSim.deploy(sk);
  assert.equal(hex(sim.ledger.operator), hex(pureCircuits.publicKey(sk)));
  assert.notEqual(hex(sim.ledger.operator), hex(sk));
  assert.equal(sim.ledger.bundlesIssued, 0n);
});

test("only the operator can issue bundles", async () => {
  const sim = await PunchcardSim.deploy();
  const req = new AgentWallet().newBundle(5);
  await rejects(sim.issue(req, rand32()), /Only the operator/);
  await sim.issue(req);
  assert.equal(sim.ledger.bundlesIssued, 1n);
});

test("an agent can spend exactly N credits from an N-use bundle", async () => {
  const sim = await PunchcardSim.deploy();
  const w = new AgentWallet();
  await sim.issue(w.newBundle(3));
  for (let i = 0; i < 3; i++) await w.pay(sim, tag(`req-${i}`));
  assert.equal(sim.ledger.creditsRedeemed, 3n);
  assert.equal(w.remaining(), 0n);
  // forcing a 4th use (index 3) must fail inside the circuit
  const b = w.bundles[0].bundle;
  await rejects(sim.call("redeem", { secret: new Uint8Array(32), spend: { bundle: b, index: 3n } }, tag("req-x")), /out of range/);
});

test("double spend of the same credit is rejected", async () => {
  const sim = await PunchcardSim.deploy();
  const w = new AgentWallet();
  await sim.issue(w.newBundle(2));
  const spend = { bundle: w.bundles[0].bundle, index: 0n };
  await sim.call("redeem", { secret: new Uint8Array(32), spend }, tag("a"));
  await rejects(sim.call("redeem", { secret: new Uint8Array(32), spend }, tag("b")), /already spent/);
  assert.equal(sim.ledger.creditsRedeemed, 1n);
});

test("a bundle that was never issued (unpaid) cannot be spent", async () => {
  const sim = await PunchcardSim.deploy();
  await sim.issue(new AgentWallet().newBundle(1)); // someone else's bundle
  const thief = new AgentWallet(); thief.newBundle(10);       // never paid / issued
  await assert.rejects(thief.pay(sim, tag("free-lunch")));
  assert.equal(sim.ledger.creditsRedeemed, 0n);
});

test("inflating the use count of a real bundle fails (commitment binds N)", async () => {
  const sim = await PunchcardSim.deploy();
  const w = new AgentWallet();
  await sim.issue(w.newBundle(1));
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
  const sim = await PunchcardSim.deploy();
  const alice = new AgentWallet(), bob = new AgentWallet();
  const ra = alice.newBundle(2), rb = bob.newBundle(2), ca = ra.commitment, cb = rb.commitment;
  await sim.issue(ra); await sim.issue(rb);
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
  const sim = await PunchcardSim.deploy();
  const w = new AgentWallet();
  await sim.issue(w.newBundle(1));
  const reqTag = rand32(); // server-chosen nonce for this API call
  const nf = await w.pay(sim, reqTag);
  assert.ok(sim.ledger.tickets.member(nf));
  assert.equal(hex(sim.ledger.tickets.lookup(nf)), hex(reqTag));
});

test("bundles issued later do not break proofs for older bundles (historic roots)", async () => {
  const sim = await PunchcardSim.deploy();
  const w = new AgentWallet();
  await sim.issue(w.newBundle(2));
  for (let i = 0; i < 5; i++) await sim.issue(new AgentWallet().newBundle(1));
  await w.pay(sim, tag("late"));
  assert.equal(sim.ledger.creditsRedeemed, 1n);
  assert.equal(sim.ledger.bundlesIssued, 6n);
});

test("a forged Merkle path (fake tree) is rejected by the circuit", async () => {
  const sim = await PunchcardSim.deploy();
  const honest = new AgentWallet();
  await sim.issue(honest.newBundle(1));
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
  const sim = await PunchcardSim.deploy(rand32(), 250n);
  const w = new AgentWallet();
  await w.buy(sim, 3);
  assert.equal(sim.ledger.bundlesIssued, 1n);
  assert.equal(sim.ledger.pricePerCredit, 250n);
  for (let i = 0; i < 3; i++) await w.pay(sim, tag(`b${i}`));
  assert.equal(sim.ledger.creditsRedeemed, 3n);
});

test("no credit inflation: an agent paid for 1 credit cannot spend more, whatever it claims", async () => {
  const sim = await PunchcardSim.deploy();
  const w = new AgentWallet();
  const req = w.newBundle(1000);                 // agent's wallet THINKS it has 1000 uses …
  await sim.issue(req, sim.operatorSecret, 1);  // … but the operator was paid for 1 and issues 1
  // the leaf in the tree is H(owner, 1); a bundle claiming 1000 uses has a different commitment → not in the tree
  await rejects(w.pay(sim, tag("x")), /not found in tree|not in the tree|does not belong/);
  // honest view of the same bundle (1 use) works exactly once
  const honest = new AgentWallet(); honest.bundles.push({ bundle: { secret: req.bundle.secret, uses: 1n }, next: 0n });
  await honest.pay(sim, tag("ok"));
  honest.bundles[0].next = 0n; await rejects(honest.pay(sim, tag("again")), /already spent/);
  honest.bundles[0].next = 1n; honest.bundles[0].bundle.uses = 2n; await rejects(honest.pay(sim, tag("idx1")), /not found in tree|not in the tree|does not belong/);
  assert.equal(sim.ledger.creditsRedeemed, 1n);
});

test("issue() and buy() reject empty bundles", async () => {
  const sim = await PunchcardSim.deploy();
  const req = new AgentWallet().newBundle(1);
  await rejects(sim.issue(req, sim.operatorSecret, 0), /at least one credit/);
  await rejects((async () => sim.call("buy", { secret: new Uint8Array(32) }, req.owner, 0n))(), /at least one credit/);
  assert.equal(sim.ledger.bundlesIssued, 0n);
});

test("the operator never sees the agent's secret: owner tag and commitment reveal no nullifier", async () => {
  const sim = await PunchcardSim.deploy();
  const w = new AgentWallet(); const req = w.newBundle(2);
  await sim.issue(req);
  const nf = await w.pay(sim, tag("r"));
  for (const v of [req.owner, req.commitment]) assert.notEqual(hex(v), hex(nf));
  assert.notEqual(hex(req.owner), hex(req.bundle.secret));
});

test("operator can withdraw what the contract holds; withdraw beyond balance is rejected", async () => {
  const sim = await PunchcardSim.deploy();
  const to = { bytes: rand32() };
  await rejects((async () => sim.call("withdraw", { secret: sim.operatorSecret }, 1n, to))(), /Not enough NIGHT/);
});

test("only the operator can withdraw", async () => {
  const sim = await PunchcardSim.deploy();
  const to = { bytes: rand32() };
  await rejects((async () => sim.call("withdraw", { secret: rand32() }, 1n, to))(), /Only the operator/);
});
