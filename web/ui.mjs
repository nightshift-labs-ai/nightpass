import { PunchcardSim, AgentWallet, rand32, hex, tag, pureCircuits } from "../src/simulator.mjs";
import { Contract } from "../contract/managed/contract/index.js";
const $ = (id) => document.getElementById(id);
const short = (u8) => hex(u8).slice(0, 16) + "…";
const sim = await PunchcardSim.deploy();
const wallet = new AgentWallet();
let served = 0, refused = 0, lastSpend = null;
const commitments = [];
const log = (html, cls = "") => { const li = document.createElement("li"); li.innerHTML = html; li.className = cls; $("events").prepend(li); };
const errMsg = (e) => String(e?.message ?? e).replace(/^.*failed assert: /, "").slice(0, 120);

function render() {
  const l = sim.ledger;
  $("left").textContent = wallet.remaining(); $("nb").textContent = wallet.bundles.length;
  $("wallet").innerHTML = wallet.bundles.length ? wallet.bundles.map((x, i) =>
    `bundle #${i + 1}: secret ${short(x.bundle.secret)}<br>&nbsp; uses ${x.next}/${x.bundle.uses} · commitment ${short(pureCircuits.bundleCommitment(x.bundle))}`).join("<br>") : "no bundles yet";
  $("bi").textContent = l.bundlesIssued; $("cr").textContent = l.creditsRedeemed;
  const nfs = [...l.tickets].map(([nf, t]) => `nullifier ${short(nf)} → ticket ${short(t)}`);
  // show commitments in shuffled order: the ledger tree reveals no owner
  $("ledger").innerHTML = `<b>commitments in tree</b><br>${commitments.map(short).join("<br>") || "—"}<br><br><b>spent nullifiers → request tickets</b><br>${nfs.join("<br>") || "—"}<br><br><b>operator key</b> ${short(l.operator)}`;
  $("served").textContent = served; $("refused").textContent = refused;
}

$("buy").onclick = async () => {
  const n = Number($("n").value);
  const req = wallet.newBundle(n), { commitment } = req;
  await sim.issue(req); commitments.push(commitment);
  log(`Agent paid for <b>${n}</b> calls and sent only its owner tag <code>${short(req.owner)}</code> → operator ran <code>issue(ownerTag, ${n})</code>; the circuit built commitment <code>${short(commitment)}</code>, the only thing the chain stores.`);
  render();
};

$("buy2").onclick = async () => {
  const n = Number($("n").value), price = sim.ledger.pricePerCredit;
  const commitment = await wallet.buy(sim, n); commitments.push(commitment);
  log(`Self-serve: agent ran <code>buy(ownerTag, ${n})</code> and paid ${n} × ${price} = <b>${BigInt(n) * price}</b> NIGHT units into the contract (<code>receiveUnshielded</code>); no operator step. The circuit built commitment <code>${short(commitment)}</code>.`);
  render();
};

const api = { pending: new Set(),
  serve(nonce, nf) { const l = sim.ledger;
    if (!this.pending.has(hex(nonce))) return [false, "403 unknown request"];
    if (!l.tickets.member(nf) || hex(l.tickets.lookup(nf)) !== hex(nonce)) return [false, "402 payment required"];
    this.pending.delete(hex(nonce)); return [true, "200 OK"]; } };

$("call").onclick = async () => {
  const nonce = rand32(); api.pending.add(hex(nonce));
  $("api").innerHTML = `request nonce ${short(nonce)}<br>waiting for anonymous payment…`;
  try {
    const x = wallet.nextSpend(); lastSpend = { bundle: x.bundle, index: x.next };
    const t0 = performance.now();
    const nf = await wallet.pay(sim, nonce);
    const [ok, msg] = api.serve(nonce, nf);
    ok ? served++ : refused++;
    $("api").innerHTML = `nonce ${short(nonce)}<br>ticket found for nullifier ${short(nf)}<br><span class="${ok ? "ok" : "bad"}">${msg}</span> — payer unknown`;
    log(`API call paid with <code>redeem()</code> (circuit ran in ${(performance.now() - t0).toFixed(0)} ms in the local simulator; on-chain this is a ZK proof) → nullifier <code>${short(nf)}</code> → <span class="ok">${msg}</span>`);
  } catch (e) { refused++; $("api").innerHTML += `<br><span class="bad">402 payment required (${errMsg(e)})</span>`; log(`API refused: ${errMsg(e)}`, "bad"); }
  render();
};

async function cheat(label, witnesses) {
  const evil = new Contract(witnesses);
  try { const r = await evil.impureCircuits.redeem(sim.ctx("redeem", {}), tag("cheat")); log(`${label}: unexpectedly succeeded`, "bad"); }
  catch (e) { log(`Blocked: ${label} → rejected by the circuit: <i>${errMsg(e)}</i>`, "ok"); }
}
const W = (b, path, i) => ({ localSecret: ({ privateState: p }) => [p, new Uint8Array(32)], bundle: ({ privateState: p }) => [p, b],
  bundlePath: ({ privateState: p }) => [p, path], useIndex: ({ privateState: p }) => [p, i] });
$("dbl").onclick = () => { if (!lastSpend) return log("Make a paid call first.");
  const path = sim.ledger.bundles.findPathForLeaf(pureCircuits.bundleCommitment(lastSpend.bundle));
  cheat("Re-spending the same credit", W(lastSpend.bundle, path, lastSpend.index)); };
$("infl").onclick = () => { const x = wallet.bundles[0]; if (!x) return log("Buy a bundle first.");
  const path = sim.ledger.bundles.findPathForLeaf(pureCircuits.bundleCommitment(x.bundle));
  cheat("Claiming 100 uses on a smaller bundle", W({ secret: x.bundle.secret, uses: 100n }, path, 99n)); };
$("fake").onclick = () => { const x = wallet.bundles[0]; if (!x) return log("Buy a bundle first.");
  const real = sim.ledger.bundles.findPathForLeaf(pureCircuits.bundleCommitment(x.bundle));
  const fake = { secret: rand32(), uses: 5n };
  cheat("Spending a bundle nobody paid for", W(fake, { leaf: pureCircuits.bundleCommitment(fake), path: real.path }, 0n)); };

log("Contract deployed in the local Midnight simulator. Buy a bundle to start.");
render();
