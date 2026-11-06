// END-TO-END HTTP PAYWALL on a real chain: deploy Punchcard, issue a bundle, run src/api-gate.mjs reading the ledger from the
// Midnight INDEXER, then pay real HTTP requests with on-chain ZK redeems. (Setup below is shared with deploy.mjs.)
// Original header: Deploy Punchcard to a public Midnight network (default: preview) and run one issue + one redeem on-chain.
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
const deployed = await deployContract(providers, { compiledContract: compiled, args: [1000n], privateStateId: "nightpass-gate", initialPrivateState: { secret: operatorSecret, next: 0 } });
const address = deployed.deployTxData.public.contractAddress;
console.log(`deployed Punchcard at ${address}`);
const iss = await deployed.callTx.issue(pureCircuits.ownerTag(bundle.secret), bundle.uses);
console.log(`issue(ownerTag, 3) in block ${iss.public.blockHeight}`);

// The API server: same gate code as the tests, but the ledger comes from the indexer.
const { createGate, requestTag } = await import("../../src/api-gate.mjs");
const getLedger = async () => npLedger((await providers.publicDataProvider.queryContractState(address)).data);
const srv = createGate({ getLedger }).listen(0);
const url = `http://127.0.0.1:${srv.address().port}/v1/data`;
const hex = (u8) => Buffer.from(u8).toString("hex");
const results = [];
const waitTicket = async (nf) => { for (let i = 0; i < 30; i++) { const l = await getLedger(); if (l.tickets.member(nf)) return; await new Promise((r) => setTimeout(r, 1000)); } };
for (let k = 0; k < 2; k++) {
  const r1 = await fetch(url); const { nonce } = await r1.json();
  const claim = new Uint8Array(randomBytes(32));
  await providers.privateStateProvider.set("nightpass-gate", { ...(await providers.privateStateProvider.get("nightpass-gate")), next: k });
  const red = await deployed.callTx.redeem(requestTag(nonce, claim));
  const nf = red.private.result;
  await waitTicket(nf);
  const thief = await fetch(url, { headers: { "x-punchcard": `${nonce}.${hex(nf)}.${hex(new Uint8Array(32))}` } });
  const hdr = { "x-punchcard": `${nonce}.${hex(nf)}.${hex(claim)}` };
  const conc = (await Promise.all([fetch(url, { headers: hdr }), fetch(url, { headers: hdr })])).map((r) => r.status);
  const r2 = { status: conc.filter((c) => c === 200).length === 1 ? 200 : `BAD ${conc}` };
  const r3 = await fetch(url, { headers: { "x-punchcard": `${nonce}.${hex(nf)}.${hex(claim)}` } });
  const row = { call: k, first: r1.status, redeemBlock: String(red.public.blockHeight), redeemTx: red.public.txId, thiefWithoutClaim: thief.status, paid: r2.status, concurrentCopies: conc, replay: r3.status };
  console.log(JSON.stringify(row)); results.push(row);
}
srv.close();
writeFileSync(new URL(`../gate-e2e-${NETWORK}.json`, import.meta.url), JSON.stringify({ network: NETWORK, address, issueBlock: String(iss.public.blockHeight), results, at: new Date().toISOString() }, null, 2));
await wallet.waitForSyncedState(); await saveWalletState(wallet, sf); await wallet.stop(); process.exit(0);
