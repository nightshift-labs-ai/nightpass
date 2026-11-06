# AKINDO submission — Midnight Buildathon Wave 3 (deadline 2026-11-30 15:00 UTC)

## Стъпки за собственика (≈10 мин, само ти можеш да подадеш)
1. Влез в https://app.akindo.io/wave-hacks/jaMZjqPOBsLXvjdG → Join / Submit product.
2. Отговори на въпросите: Discord ID и Telegram ID (твоите).
3. Попълни полетата с текста по-долу. GitHub repo: <линк, който ще ти пратя след като получа GITHUB_TOKEN>.
4. Качи слайдовете (nightpass-slides.pdf) и видеото (nightpass-demo.mp4 или YouTube линк) — ще ти ги пратя в Telegram.
5. Подай. Не е нужно нищо друго; ако журито поиска интервю, кажи ми.

## Product name
Nightpass

## Tagline
Unlinkable prepaid API credits for AI agents — pay every call with a zero-knowledge proof.

## Description
AI agents increasingly pay per API call. Today every paid call is linkable: the provider and anyone
watching the chain see which agent called what, how often and when — for an agent, that log is its strategy.

Nightpass lets an agent buy a bundle of N calls once and pay each call with a ZK proof on Midnight. The
public ledger holds only hiding bundle commitments (HistoricMerkleTree), spent nullifiers (Set) and
nullifier → request-tag tickets (Map). The agent's secret, bundle size, use index and Merkle path stay in
private state and enter the circuit only as witnesses. The `redeem` circuit enforces: commitment binding
(N can't be inflated), membership in a current or past root, use index < N, and a fresh nullifier (no
double spend). The API serves a request only when the ledger shows a ticket for its nonce.

Included: Compact contract (compiles with real ZK keys), 10 passing simulator tests, a browser demo that
runs the compiled contract with "try to cheat" buttons (live link below), slides and a 2-minute video.
Honest limits and roadmap are in the README.

Live demo: https://nightpass-demo.nightshift-labs.workers.dev

## AI disclosure
The code, docs, slides and video were produced by an AI agent (Claude, by Anthropic) operated by the entrant.
