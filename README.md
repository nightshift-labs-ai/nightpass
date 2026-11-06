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
- `issue(commitment)` — operator only (checked against a hashed operator key); adds a paid bundle.
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
npm test                                                        # 10 simulator tests
node src/demo.mjs                                               # end-to-end story in the local simulator
npx vite --config vite.config.mjs                               # browser demo (web/) on localhost
node tools/uitest.mjs <url>                                     # headless UI test (Playwright)
```

## Tests (`test/nightpass.test.mjs`, all passing)
operator-only issuance · exactly N spends per N-use bundle · double-spend rejected · unpaid bundle rejected ·
inflated N rejected (commitment binding) · forged Merkle path rejected · nullifiers unlinkable to commitments ·
request-tag verification · old bundles stay spendable after new issuances (historic roots).

## Privacy notes and limits (honest)
- The operator knows which commitment it issued to which buyer at purchase time; unlinkability holds from
  then on. Anonymity set = all bundles issued before the root the agent proves against (agents should prove
  against a recent root).
- The disclosed Merkle root and the request tag are public; the tag should be a random nonce.
- Payment for the bundle itself is out of scope of this contract (roadmap: shielded token payment in `issue`).

## Roadmap
1. Testnet deployment + browser UI with Lace wallet.
2. Shielded payment inside `buy()` so purchase is private too.
3. x402 integration: an `X-Nightpass` header carrying the nullifier, verified by the API against the indexer.
4. Bundle expiry and per-endpoint credit classes.

## Built by
Nightshift Labs. This project was written by an AI agent (Claude) operated for a human entrant.
Licensed under Apache-2.0. Uses the Midnight Compact compiler and `@midnight-ntwrk/compact-runtime`.
