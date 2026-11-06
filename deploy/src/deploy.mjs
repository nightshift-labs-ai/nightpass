// Deploy Punchcard to a public Midnight network (default: preview) and run one issue + one redeem on-chain.
// Needs: funded wallet (tNIGHT from the faucet), local proof server 8.1.3 on :6300, contract compiled with Compact 0.31.1 into ./managed.
import { CONFIG, NETWORK } from "./config.mjs";
import * as Rx from "rxjs";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { deployContract, getUnshieldedBalances } from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { ttlOneHour } from "@midnight-ntwrk/midnight-js-utils";
import { Contract, ledger as npLedger, pureCircuits } from "../managed/contract/index.js";
import { deriveWalletKeys, readSeed } from "./keys.mjs";
import { buildWallet, loadWalletState, saveWalletState, submitWithRetry, walletStateFile } from "./wallet.mjs";

const DIR = new URL("../managed", import.meta.url).pathname;
// Fixed per-run password unless provided, so the stored private state can be reopened by later runs.
const password = process.env.PRIVATE_STATE_PASSWORD ?? "Nightpass-Demo-2026-" + NETWORK;
const keys = deriveWalletKeys(readSeed());
const { shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = keys;
const sf = walletStateFile(keys);
const wallet = await buildWallet(keys, await loadWalletState(sf));
let state = await wallet.waitForSyncedState();
console.log(`[${NETWORK}] wallet synced: ${unshieldedKeystore.getBech32Address().asString()}`);

const unregistered = state.unshielded.availableCoins.filter((c) => c.meta?.registeredForDustGeneration !== true);
if (unregistered.length > 0) {
  const { fee } = await wallet.estimateRegistration(unregistered);
  await wallet.waitForGeneratedDust(unregistered, fee);
  const recipe = await wallet.registerNightUtxosForDustGeneration(unregistered, unshieldedKeystore.getPublicKey(), (p) => unshieldedKeystore.signData(p));
  await submitWithRetry(wallet, await wallet.finalizeRecipe(recipe));
  console.log(`registered ${unregistered.length} NIGHT UTXO(s) for DUST generation`);
}
state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced), Rx.filter((s) => s.dust.balance(new Date()) > 0n)));
console.log(`DUST (SPECK): ${state.dust.balance(new Date())}`);

const walletProvider = {
  getCoinPublicKey: () => shieldedSecretKeys.coinPublicKey,
  getEncryptionPublicKey: () => shieldedSecretKeys.encryptionPublicKey,
  // sign the recipe with the unshielded key: needed when the wallet adds NIGHT inputs (buy() pays NIGHT into the contract)
  balanceTx: async (tx, ttl = ttlOneHour()) => wallet.finalizeRecipe(await wallet.signRecipe(
    await wallet.balanceUnboundTransaction(tx, { shieldedSecretKeys, dustSecretKey }, { ttl }), (d) => unshieldedKeystore.signData(d))),
  submitTx: (tx) => submitWithRetry(wallet, tx),
};
const zk = new NodeZkConfigProvider(DIR);
const providers = {
  privateStateProvider: levelPrivateStateProvider({ privateStateStoreName: "nightpass-private-state", signingKeyStoreName: "nightpass-signing-keys",
    privateStoragePasswordProvider: () => password, accountId: unshieldedKeystore.getBech32Address().asString() }),
  publicDataProvider: indexerPublicDataProvider(CONFIG.indexerHttpUrl, CONFIG.indexerWsUrl),
  zkConfigProvider: zk, proofProvider: httpClientProofProvider(CONFIG.proofServer, zk), walletProvider, midnightProvider: walletProvider,
};

// Private state: operator secret + the bundle the agent will spend (demo: one process plays both roles).
const bundle = { secret: new Uint8Array(randomBytes(32)), uses: 3n };
const witnesses = {
  localSecret: ({ privateState }) => [privateState, Uint8Array.from(Buffer.from(privateState.secret, "hex"))],
  bundle: ({ privateState }) => [privateState, bundle],
  bundlePath: ({ privateState, ledger }) => [privateState, ledger.bundles.findPathForLeaf(pureCircuits.bundleCommitment(bundle))],
  useIndex: ({ privateState }) => [privateState, BigInt(privateState.next ?? 0)],
};
const compiled = CompiledContract.withCompiledFileAssets(CompiledContract.withWitnesses(CompiledContract.make("nightpass", Contract), witnesses), DIR);
const operatorSecret = randomBytes(32).toString("hex");
const deployed = await deployContract(providers, { compiledContract: compiled, args: [1000n], privateStateId: "nightpass", initialPrivateState: { secret: operatorSecret, next: 0 } });
const address = deployed.deployTxData.public.contractAddress;
console.log(`deployed Punchcard at ${address}`);
const log = [];
const step = (name, r) => { const b = String(r.public.blockHeight); log.push({ step: name, block: b, txId: r.public.txId }); console.log(`${name} landed in block ${b} (tx ${r.public.txId})`); };
// 1) operator issues a 3-credit bundle: the agent hands over only ownerTag = H(secret); the commitment is built in-circuit
step("issue(ownerTag, 3)", await deployed.callTx.issue(pureCircuits.ownerTag(bundle.secret), bundle.uses));
// 2) agent spends credit #0 anonymously (ZK proof of membership + fresh nullifier)
step("redeem(requestTag) #0", await deployed.callTx.redeem(new Uint8Array(randomBytes(32))));
// 3) double spend of credit #0 must be rejected (by the local proof run, before anything is submitted)
let doubleSpend = "accepted (BUG)";
try { await deployed.callTx.redeem(new Uint8Array(randomBytes(32))); } catch (e) { doubleSpend = "rejected: " + String(e?.message ?? e).replace(/^[\s\S]*failed assert: /, "").slice(0, 120); }
console.log(`double spend of credit #0: ${doubleSpend}`); log.push({ step: "redeem #0 again (double spend)", result: doubleSpend });
// 4) agent spends credit #1 (private state moves the use index forward)
await providers.privateStateProvider.set("nightpass", { ...(await providers.privateStateProvider.get("nightpass")), next: 1 });
step("redeem(requestTag) #1", await deployed.callTx.redeem(new Uint8Array(randomBytes(32))));
// 5) self-serve: a second agent buys 2 credits and pays 2 x 1000 NIGHT units into the contract (unshielded), no operator step
const bundle2 = { secret: new Uint8Array(randomBytes(32)), uses: 2n };
step("buy(ownerTag, 2) paying 2000 NIGHT units", await deployed.callTx.buy(pureCircuits.ownerTag(bundle2.secret), bundle2.uses));
const bal1 = await getUnshieldedBalances(providers.publicDataProvider, address);
console.log(`contract unshielded balance after buy(): ${JSON.stringify(bal1, (k, v) => typeof v === "bigint" ? String(v) : v)}`);
log.push({ step: "contract balance after buy()", balance: JSON.stringify(bal1, (k, v) => typeof v === "bigint" ? String(v) : v) });
// 6) operator withdraws 1500 of it to its own unshielded address
try {
  const to = { bytes: Uint8Array.from(Buffer.from(String(unshieldedKeystore.getAddress()).replace(/^0x/, ""), "hex")) };
  step("withdraw(1500, operator)", await deployed.callTx.withdraw(1500n, to));
  const bal2 = await getUnshieldedBalances(providers.publicDataProvider, address);
  console.log(`contract unshielded balance after withdraw(): ${JSON.stringify(bal2, (k, v) => typeof v === "bigint" ? String(v) : v)}`);
  log.push({ step: "contract balance after withdraw()", balance: JSON.stringify(bal2, (k, v) => typeof v === "bigint" ? String(v) : v) });
} catch (e) { console.log("withdraw failed: " + String(e?.message ?? e).slice(0, 300)); log.push({ step: "withdraw", result: "failed: " + String(e?.message ?? e).slice(0, 200) }); }
const cs = await providers.publicDataProvider.queryContractState(address);
const l = npLedger(cs.data);
console.log(`on-chain: bundlesIssued=${l.bundlesIssued} creditsRedeemed=${l.creditsRedeemed} spentNullifiers=${l.spent.size()} tickets=${l.tickets.size()}`);
const iss = { public: { blockHeight: log[0].block } }, red = { public: { blockHeight: log[1].block } };
writeFileSync(new URL(`../deployment-${NETWORK}.json`, import.meta.url), JSON.stringify({ network: NETWORK, address, steps: log, ledger: { bundlesIssued: String(l.bundlesIssued), creditsRedeemed: String(l.creditsRedeemed) }, at: new Date().toISOString() }, null, 2));
await wallet.waitForSyncedState(); await saveWalletState(wallet, sf); await wallet.stop(); process.exit(0);
