# Nightpass — unlinkable prepaid API credits for AI agents (Midnight)

AI agents increasingly pay per API call (x402-style micropayments). Today every paid call is
linkable: the API provider — and anyone watching the chain — sees which wallet called which
endpoint, how often, and when. For an agent that is a full leak of its strategy.

**Nightpass** lets an agent buy a bundle of *N* calls once, then pay each call with a
zero-knowledge proof on Midnight. The provider learns *"this call was paid by a valid, unspent
credit"* — never which bundle, which buyer, or how many credits are left.

**Live demo:** https://nightpass-demo.nightshift-labs.workers.dev (the compiled contract running in the browser on the local Midnight simulator) · **Live chain view:** https://nightpass-demo.nightshift-labs.workers.dev/live/ (reads the deployed contracts from the public preview indexer and decodes their ledger in the browser) · Slides: `docs/nightpass-slides.pdf`

## How it works (dual-ledger model)

| | Public ledger (on-chain) | Private state (agent only) |
|---|---|---|
| Bundle | commitment `H(ownerTag, N)` with `ownerTag = H(secret)`, in a `HistoricMerkleTree<16>` | `secret`, `N`, next index |
| Spend | nullifier `H(secret, i)` in `Set`, `nullifier → requestTag` in `Map` | which bundle, which `i`, Merkle path |
| Counters | `bundlesIssued`, `creditsRedeemed` | remaining credits |

Circuits (`contract/nightpass.compact`):
- `buy(ownerTag, uses)` — **self-serve**: the agent pays `uses × pricePerCredit` NIGHT into the contract (`receiveUnshielded`); the circuit itself computes the commitment `H(ownerTag, uses)` and inserts it.
- `withdraw(amount, to)` — operator only; sends collected NIGHT out (`sendUnshielded`).
- `issue(ownerTag, uses)` — operator only (checked against a hashed operator key); adds a bundle paid off-chain (e.g. via x402).
  The agent hands over only `ownerTag = H(secret)` and the operator sets `uses` to what was paid. Because the commitment is computed
  **inside** the circuit, an agent cannot slip in a bigger bundle than it paid for, and the operator never learns `secret`
  (so it cannot compute the agent's nullifiers).
- `redeem(requestTag)` — the agent proves in ZK, using witnesses `bundle()`, `bundlePath()`, `useIndex()`:
  1. the path leaf equals `bundleCommitment(bundle) = H(H(secret), N)` (so `N` can't be inflated),
  2. the path root is a current or past root of the bundle tree (`checkRoot`),
  3. `useIndex < N`,
  4. the nullifier `H(secret, useIndex)` is unspent → inserts it and records the request tag.
- Pure helpers `ownerTag`, `commitmentOf`, `bundleCommitment`, `nullifier`, `publicKey` are exported so TypeScript computes identical hashes.

The API server issues a random nonce per request; the agent picks a random `claim` and redeems with `requestTag = sha256(nonce ‖ claim)`;
the server serves the call only if `tickets[nullifier] == sha256(nonce ‖ claim)`. Double spends fail in the circuit; because only the hash
is on-chain, someone watching the chain cannot replay the ticket and take the response the agent paid for.

## Run it

Requires Node 22 and the Compact toolchain (compiler 0.36.0).

```bash
npm install
compact compile contract/nightpass.compact contract/managed     # real ZK keys (~10 s); add --skip-zk for fast iteration
npm test                                                        # 19 tests (16 contract + 3 HTTP paywall)
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

## Tests (`test/*.test.mjs`, 19/19 passing)
operator-only issuance · exactly N spends per N-use bundle · double-spend rejected · unpaid bundle rejected ·
inflated N rejected (commitment binding) · **no inflation through `issue()`** (agent paid for 1 can't spend 2) · empty bundles rejected ·
forged Merkle path rejected · nullifiers unlinkable to commitments · operator never sees the secret · request-tag verification ·
old bundles stay spendable after new issuances (historic roots) · self-serve `buy()` · operator-only / balance-checked `withdraw()` ·
HTTP gate: 402 → 200, replay 403, **chain watcher can't front-run a paid call**, nonces expire.

## HTTP paywall (x402-style) — `src/api-gate.mjs`
`GET /v1/data` → `402 {nonce}` → the agent runs `redeem(sha256(nonce ‖ claim))` → retries with `X-Nightpass: <nonce>.<nullifier>.<claim>` → `200`.
Replaying the header gives `403`; an old nullifier can't pay a new nonce; nonces expire (default 2 min) and the pending set is bounded. The same gate reads `tickets` from the Midnight indexer in production (verified on a real chain, see below).

## Deploying to a public network — `deploy/`
Public Midnight networks run ledger 8, so `deploy/` pins Compact 0.31.1, compact-runtime 0.16.0, Midnight.js 4.1.1 and proof server 8.1.3
(the root project uses the newest compiler, 0.36, for local tests). `deploy/src/deploy.mjs` syncs a wallet, registers NIGHT for DUST,
deploys (default `preview`), then runs issue → redeem → rejected double spend → redeem → buy → withdraw on-chain. `deploy/test-ledger8.sh` runs the 16 contract tests on the ledger-8 build (all pass).

## Live on the public Midnight `preview` network
Contract **`152c84984494587b0a2b58b3ab2e17eae612c1be5ce7c8fc254bfdf7134056b3`** (deployed with `deploy/src/deploy.mjs`, real proofs, Compact 0.31.1 / ledger 8).

| Step | Block on preview |
|---|---|
| `issue(ownerTag, 3)` | 1618076 |
| `redeem` credit #0 | 1618081 |
| `redeem` credit #0 again (double spend) | rejected: "This credit was already spent" |
| `redeem` credit #1 | 1618085 |
| `buy(ownerTag, 2)` paying 2000 NIGHT units | 1618089 |
| `withdraw(1500, operator)` | 1618093 |
| final public ledger | `bundlesIssued=2 creditsRedeemed=2` |

Tx ids: [`docs/preview-run.txt`](docs/preview-run.txt), [`docs/preview-deployment.json`](docs/preview-deployment.json).

**Live chain view** — https://nightpass-demo.nightshift-labs.workers.dev/live/ (`deploy/live-web/`, built by `deploy.sh`):
the browser queries `indexer.preview.midnight.network` (GraphQL `contractAction`), deserializes the contract state with
`compact-runtime` 0.16 and decodes it with the compiled ledger-8 contract (`deploy/managed`). It shows both deployed
contracts' counters, Merkle root of bundle commitments, every spent nullifier → request ticket, the sealed operator key, and
the contract's NIGHT balance (500 = 2000 paid by `buy()` − 1500 withdrawn). A "check a nullifier" box runs the same
`spent.member()` test the API gate uses. Headless test: `node tools/livetest.mjs <url>/live/`.

## Verified on a real Midnight chain (local `undeployed` network, real ZK proofs)
`deploy/src/deploy.mjs` with `MIDNIGHT_NETWORK=undeployed` ran the full flow against a local Midnight node 1.0.0 + indexer 4.3.3 +
proof server 8.1.3 (the versions in Midnight's own local-network compose file), with real proofs for every call.
Transcript: [`docs/localnet-run.txt`](docs/localnet-run.txt), block numbers + tx ids: [`docs/localnet-deployment.json`](docs/localnet-deployment.json).

| Step | Result |
|---|---|
| deploy (price 1000 / credit) | contract `7e9c09bf…9ca8` |
| `issue(ownerTag, 3)` | block 71 |
| `redeem` credit #0 | block 75 |
| `redeem` credit #0 again (double spend) | rejected: "This credit was already spent" |
| `redeem` credit #1 | block 79 |
| `buy(ownerTag, 2)` paying 2 × 1000 NIGHT units into the contract | block 82 |
| `withdraw(1500, operator)` — passes the in-circuit `unshieldedBalanceGte` check, so the NIGHT from `buy()` really arrived | block 86 |
| final public ledger | `bundlesIssued=2 creditsRedeemed=2`, 2 nullifiers, 2 tickets |

To reproduce: start a local network (Midnight's `standalone.yml`: node, indexer, proof server), then
`cd deploy && MIDNIGHT_NETWORK=undeployed WALLET_SEED=<genesis seed 00…01> node src/deploy.mjs`.
Note: calls that move unshielded NIGHT (`buy`) need the balancing recipe signed with the unshielded key (`wallet.signRecipe`), otherwise the node rejects the transaction (error 192).

### HTTP paywall paid by real on-chain proofs
`deploy/src/gate-e2e.mjs` runs `src/api-gate.mjs` with the ledger read **from the Midnight indexer** (not the simulator) and pays
real HTTP requests with on-chain `redeem` transactions ([`docs/gate-e2e-localnet.json`](docs/gate-e2e-localnet.json)):

| Call | No header | redeem tx | Chain watcher replays the ticket without the claim | Agent with claim | Same header again |
|---|---|---|---|---|---|
| 1 | 402 | block 36 | 402 | **200** | 403 |
| 2 | 402 | block 40 | 402 | **200** | 403 |

Same test on the **public preview network** (contract `402c9059ec4baf3daae5a79301f6d838866c97af17a2c1744e4b23c57c5c8150`, [`docs/gate-e2e-preview.json`](docs/gate-e2e-preview.json)):

| Call | No header | redeem tx | Replay without claim | Agent with claim | Same header again |
|---|---|---|---|---|---|
| 1 | 402 | block 1618162 | 402 | **200** | 403 |
| 2 | 402 | block 1618167 | 402 | **200** | 403 |

## Privacy notes and limits (honest)
- The operator knows which commitment it issued to which buyer at purchase time; unlinkability holds from
  then on. Anonymity set = all bundles issued before the root the agent proves against (agents should prove
  against a recent root).
- The disclosed Merkle root and the request tag are public; the tag is a hash of the nonce and a one-time claim secret.
- Network-level metadata is outside the contract: the API sees the client's IP and timing, and the wallet that pays the DUST fee for
  `redeem` is visible. For real unlinkability, use a fresh fee wallet (or a relayer) for redemptions, not the wallet that ran `buy()`,
  and a network path that hides your IP.
- The tree has 2^16 leaves; when it is full, a new contract must be deployed (bundles in the old one stay spendable).
- `buy()` uses an unshielded NIGHT payment, so the purchase itself is public (who bought how many); unlinkability starts after it. Roadmap: shielded payment.

## Roadmap
1. Browser UI with Lace wallet against the preview deployment.
2. Shielded payment in `buy()` so the purchase is private too.
3. x402 integration: an `X-Nightpass` header carrying the nullifier, verified by the API against the indexer.
4. Bundle expiry and per-endpoint credit classes.

## Built by
Nightshift Labs. This project was written by an AI agent (Claude) operated for a human entrant.
Licensed under Apache-2.0. Uses the Midnight Compact compiler and `@midnight-ntwrk/compact-runtime`.
