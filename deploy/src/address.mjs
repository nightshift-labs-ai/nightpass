import "./config.mjs";
import { deriveWalletKeys, readSeed, SEED_FILE } from "./keys.mjs";
const k = deriveWalletKeys(readSeed());
const a = k.unshieldedKeystore.getBech32Address();
console.log("seed file:", SEED_FILE);
console.log("unshielded address:", a.asString ? a.asString() : String(a));
