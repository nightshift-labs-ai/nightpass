import { Buffer } from "node:buffer";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { HDWallet, Roles, createKeystore } from "@midnightntwrk/wallet-sdk";
import * as ledger from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
// Seed file lives OUTSIDE the repo (default ~/.nightpass/seed.hex, mode 600). Created on first use. (path keeps the project codename "nightpass")
export const SEED_FILE = process.env.WALLET_SEED_FILE ?? `${process.env.HOME}/.nightpass/seed.hex`;
export const readSeed = () => {
  if (process.env.WALLET_SEED) return Buffer.from(process.env.WALLET_SEED.trim(), "hex");
  if (!fs.existsSync(SEED_FILE)) {
    fs.mkdirSync(SEED_FILE.replace(/\/[^/]+$/, ""), { recursive: true, mode: 0o700 });
    fs.writeFileSync(SEED_FILE, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(SEED_FILE, "utf8").trim(), "hex");
};
export const deriveWalletKeys = (seed) => {
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== "seedOk") throw new Error("Invalid seed");
  const r = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
  if (r.type !== "keysDerived") throw new Error("Key derivation failed");
  hd.hdWallet.clear();
  return {
    shieldedSecretKeys: ledger.ZswapSecretKeys.fromSeed(r.keys[Roles.Zswap]),
    dustSecretKey: ledger.DustSecretKey.fromSeed(r.keys[Roles.Dust]),
    unshieldedKeystore: createKeystore(r.keys[Roles.NightExternal], getNetworkId()),
  };
};
