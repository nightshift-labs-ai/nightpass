# Nightpass — unlinkable prepaid API credits for AI agents (Midnight)

AI agents increasingly pay per API call (x402-style micropayments). Today every paid call is
linkable: the API provider — and anyone watching the chain — sees which wallet called which
endpoint, how often, and when. For an agent that is a full leak of its strategy.

**Nightpass** lets an agent buy a bundle of *N* calls once, then pay each call with a
zero-knowledge proof on Midnight. The provider learns *"this call was paid by a valid, unspent
credit"* — never which bundle, which buyer, or how many credits are left.

**Live demo:** https://nightpass-demo.nightshift-labs.workers.dev (the compiled contract running in the browser on the local Midnight simulator) · Slides: `docs/nightpass-slides.pdf`

## How it works (dual-ledger model)

| | Public ledger (on-chain) | Private state (agent only) |
|---|---|---|
| Bundle | hiding commitment `H(secret, N)` in a `HistoricMerkleTree<16>` | `secret`, `N`, next index |
| Spend | nullifier `H(secret, i)` in `Set`, `nullifier → requestTag` in `Map` | which bundle, which `i`, Merkle path |
| Counters | `bundlesIssued`, `creditsRedeemed` | remaining credits |

Circuits (`contract/nightpass.compact`):
- `buy(commitment, uses)` — **self-serve**: the agent pays `uses × pricePerCredit` NIGHT into the contract (`receiveUnshielded`) and adds its own commitment; the circuit checks the commitment really encodes `uses`.
- `issue(commitment)` — operator only (checked against a hashed operator key); adds a bundle paid off-chain (e.g. via x402).
- `redeem(requestTag)` — the agent proves in ZK, using witnesses `bundle()`, `bundlePath()`, `useIndex()`:
  1. the path leaf equals `bundleCommitment(bundle)` (so `N` can't be inflated),
  2. the path root is a current or past root of the bundle tree (`checkRoot`),
  3. `useIndex < N`,
  4. the nullifier `H(secret, useIndex)` is unspent → inserts it and records the request tag.
- Pure helpers `bundleCommitment`, `nullifier`, `publicKey` are exported so TypeScript computes identical hashes.

The API server issues a random nonce per request; the agent redeems with `requestTag = nonce`;
the server serves the call only if `tickets[nullifier] == nonce`. Replays fail in the circuit.

## Run it

Requires Node 22 and the Compact toolchain (compiler 0.36.0).

```bash
npm install
compact compile contract/nightpass.compact contract/managed     # real ZK keys (~10 s); add --skip-zk for fast iteration
npm test                                                        # 13 tests (12 contract + 1 HTTP paywall)
node src/demo.mjs                                               # end-to-end story in the local simulator
npx vite --config vite.config.mjs                               # browser demo (web/) on localhost
node tools/uitest.mjs <url>                                     # headless UI test (Playwright)
```

## Circuit size (measured, `compact compile` without `--skip-zk`)
| Circuit | ZKIR instructions | Prover key | Verifier key |
|---|---|---|---|
| `issue` | 114 | 11.3 MB | 2.1 kB |
| `redeem` (Merkle depth 16 + 2 hashes + set/map updates) | 246 | 22.6 MB | 2.1 kB |

Depth 16 allows 65,536 bundles per contract; raising it grows `redeem` linearly in the path length.

## Tests (`test/nightpass.test.mjs`, all passing)
operator-only issuance · exactly N spends per N-use bundle · double-spend rejected · unpaid bundle rejected ·
inflated N rejected (commitment binding) · forged Merkle path rejected · nullifiers unlinkable to commitments ·
request-tag verification · old bundles stay spendable after new issuances (historic roots).

## HTTP paywall (x402-style) — `src/api-gate.mjs`
`GET /v1/data` → `402 {nonce}` → the agent runs `redeem(nonce)` → retries with `X-Nightpass: <nonce>.<nullifier>` → `200`.
Replaying the header gives `403`; an old nullifier can't pay a new nonce. In production the gate reads `tickets` from the Midnight indexer.

## Deploying to a public network — `deploy/`
Public Midnight networks run ledger 8, so `deploy/` pins Compact 0.31.1, compact-runtime 0.16.0, Midnight.js 4.1.1 and proof server 8.1.3
(the root project uses the newest compiler, 0.36, for local tests). `deploy/src/deploy.mjs` syncs a wallet, registers NIGHT for DUST,
deploys to `preview`, then runs one `issue` and one `redeem` on-chain. `deploy/test-ledger8.sh` runs the same 12 contract tests on the ledger-8 build (all pass).

## Privacy notes and limits (honest)
- The operator knows which commitment it issued to which buyer at purchase time; unlinkability holds from
  then on. Anonymity set = all bundles issued before the root the agent proves against (agents should prove
  against a recent root).
- The disclosed Merkle root and the request tag are public; the tag should be a random nonce.
- `buy()` uses an unshielded NIGHT payment, so the purchase itself is public (who bought how many); unlinkability starts after it. Roadmap: shielded payment.

## Roadmap
1. Testnet deployment + browser UI with Lace wallet.
2. Shielded payment in `buy()` so the purchase is private too; operator withdrawal circuit.
3. x402 integration: an `X-Nightpass` header carrying the nullifier, verified by the API against the indexer.
4. Bundle expiry and per-endpoint credit classes.

## Built by
Nightshift Labs. This project was written by an AI agent (Claude) operated for a human entrant.
Licensed under Apache-2.0. Uses the Midnight Compact compiler and `@midnight-ntwrk/compact-runtime`.
