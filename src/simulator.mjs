// Local Midnight simulator for the Nightpass contract (no network, no proof server).
// Runs the compiled circuits exactly as the proof server would, including all asserts.
import * as rt from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, pureCircuits } from "../contract/managed/contract/index.js";

export const rand32 = () => globalThis.crypto.getRandomValues(new Uint8Array(32));
export const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
export const tag = (s) => { const b = new Uint8Array(32); b.set(new TextEncoder().encode(s).slice(0, 32)); return b; };
export { pureCircuits };

// Witnesses read only the caller's private state. Nothing here is sent on-chain.
const witnesses = {
  localSecret: ({ privateState }) => [privateState, privateState.secret],
  bundle: ({ privateState }) => [privateState, privateState.spend.bundle],
  bundlePath: ({ privateState, ledger: l }) => {
    const leaf = pureCircuits.bundleCommitment(privateState.spend.bundle);
    const p = l.bundles.findPathForLeaf(leaf);
    if (!p) throw new Error("bundle not found in tree (local check)");
    return [privateState, p];
  },
  useIndex: ({ privateState }) => [privateState, privateState.spend.index],
};

export class NightpassSim {
  static async deploy(operatorSecret = rand32(), price = 1000n) {
    const sim = new NightpassSim();
    sim.contract = new Contract(witnesses);
    sim.address = rt.sampleContractAddress();
    const init = await sim.contract.initialState(rt.createConstructorContext({ secret: operatorSecret }, "0".repeat(64)), price);
    sim.state = init.currentContractState.data;
    sim.operatorSecret = operatorSecret;
    return sim;
  }
  ctx(circuitId, privateState) {
    // compact-runtime >= 0.19 takes one options object; 0.16 (ledger 8, public networks) takes positional args.
    return rt.createCircuitContext.length >= 4
      ? rt.createCircuitContext(this.address, "0".repeat(64), this.state, privateState)
      : rt.createCircuitContext({ circuitId, contractAddress: this.address, coinPublicKeyOrZswapState: "0".repeat(64),
          contractState: this.state, privateState });
  }
  async call(name, privateState, ...args) {
    const r = await this.contract.impureCircuits[name](this.ctx(name, privateState), ...args);
    this.state = (r.context.callContext?.currentQueryContext ?? r.context.currentQueryContext).state;
    return r.result;
  }
  get ledger() { return ledger(this.state); }
  // operator action
  issue(commitment, secret = this.operatorSecret) { return this.call("issue", { secret }, commitment); }
}

// The agent's wallet: keeps bundles + next unused index privately.
export class AgentWallet {
  constructor() { this.bundles = []; }
  newBundle(uses) {
    const b = { secret: rand32(), uses: BigInt(uses) };
    this.bundles.push({ bundle: b, next: 0n });
    return { bundle: b, commitment: pureCircuits.bundleCommitment(b) };
  }
  // self-serve: pay uses * price NIGHT in-contract and register the commitment (no operator step)
  async buy(sim, uses) {
    const { bundle, commitment } = this.newBundle(uses);
    await sim.call("buy", { secret: new Uint8Array(32), spend: { bundle, index: 0n } }, commitment, BigInt(uses));
    return commitment;
  }
  remaining() { return this.bundles.reduce((s, x) => s + (x.bundle.uses - x.next), 0n); }
  // pick a bundle with credit left; returns the private spend data for the witness
  nextSpend() {
    const x = this.bundles.find((x) => x.next < x.bundle.uses);
    if (!x) throw new Error("no credits left");
    return x;
  }
  async pay(sim, requestTag) {
    const x = this.nextSpend();
    const nf = await sim.call("redeem", { secret: new Uint8Array(32), spend: { bundle: x.bundle, index: x.next } }, requestTag);
    x.next += 1n;
    return nf;
  }
}
