// Deploy Nightpass to a public Midnight network (default: preview) and run one issue + one redeem on-chain.
// Needs: funded wallet (tNIGHT from the faucet), local proof server 8.1.3 on :6300, contract compiled with Compact 0.31.1 into ./managed.
import { CONFIG, NETWORK } from "./config.mjs";
import * as Rx from "rxjs";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
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
const password = process.env.PRIVATE_STATE_PASSWORD ?? randomBytes(16).toString("hex");
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
  balanceTx: async (tx, ttl = ttlOneHour()) => wallet.finalizeRecipe(await wallet.balanceUnboundTransaction(tx, { shieldedSecretKeys, dustSecretKey }, { ttl })),
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
console.log(`deployed Nightpass at ${address}`);
const iss = await deployed.callTx.issue(pureCircuits.bundleCommitment(bundle));
console.log(`issue() landed in block ${iss.public.blockHeight}`);
const red = await deployed.callTx.redeem(new Uint8Array(randomBytes(32)));
console.log(`redeem() landed in block ${red.public.blockHeight}`);
const cs = await providers.publicDataProvider.queryContractState(address);
const l = npLedger(cs.data);
console.log(`on-chain: bundlesIssued=${l.bundlesIssued} creditsRedeemed=${l.creditsRedeemed}`);
writeFileSync(new URL("../deployment.json", import.meta.url), JSON.stringify({ network: NETWORK, address, issueBlock: String(iss.public.blockHeight), redeemBlock: String(red.public.blockHeight), at: new Date().toISOString() }, null, 2));
await wallet.waitForSyncedState(); await saveWalletState(wallet, sf); await wallet.stop(); process.exit(0);
