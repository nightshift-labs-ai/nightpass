import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { WalletFacade, ShieldedWallet, DustWallet, UnshieldedWallet, PublicKey, NoOpTransactionHistoryStorage } from "@midnightntwrk/wallet-sdk";
import * as ledger from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { CONFIG } from "./config.mjs";
export const walletStateFile = (k) => `${process.env.WALLET_STATE_DIR ?? "."}/wallet-state-${getNetworkId()}.json`;
export const loadWalletState = async (f) => (existsSync(f) ? JSON.parse(await readFile(f, "utf8")) : undefined);
export const saveWalletState = async (w, f) => {
  const s = { shielded: await w.shielded.serializeState(), unshielded: await w.unshielded.serializeState(), dust: await w.dust.serializeState() };
  await writeFile(`${f}.tmp`, JSON.stringify(s), { mode: 0o600 }); await rename(`${f}.tmp`, f);
};
export const buildWallet = async (keys, saved) => {
  const { shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = keys;
  const wallet = await WalletFacade.init({
    configuration: {
      networkId: getNetworkId(),
      indexerClientConnection: { indexerHttpUrl: CONFIG.indexerHttpUrl, indexerWsUrl: CONFIG.indexerWsUrl },
      provingServerUrl: new URL(CONFIG.proofServer), relayURL: new URL(CONFIG.node.replace(/^http/, "ws")),
      txHistoryStorage: new NoOpTransactionHistoryStorage(),
      costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
    },
    shielded: (c) => (saved ? ShieldedWallet(c).restore(saved.shielded) : ShieldedWallet(c).startWithSecretKeys(shieldedSecretKeys)),
    unshielded: (c) => (saved ? UnshieldedWallet(c).restore(saved.unshielded) : UnshieldedWallet(c).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore))),
    dust: (c) => (saved ? DustWallet(c).restore(saved.dust) : DustWallet(c).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust)),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return wallet;
};
export const submitWithRetry = async (wallet, tx, attempts = 3) => {
  for (let i = 1; ; i++) { try { return await wallet.submitTransaction(tx); } catch (e) { if (i >= attempts) throw e; await new Promise((r) => setTimeout(r, 2000)); } }
};
