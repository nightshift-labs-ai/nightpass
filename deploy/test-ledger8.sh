#!/usr/bin/env bash
# Run the contract test suite against the ledger-8 build (Compact 0.31.1 + compact-runtime 0.16.0 used for public networks).
set -euo pipefail; cd "$(dirname "$0")"; T=.l8test; rm -rf $T; mkdir -p $T/src $T/test
[ -d managed ] || compact compile +0.31.1 ../contract/punchcard.compact managed
sed 's#../contract/managed/contract/index.js#../../managed/contract/index.js#g' ../src/simulator.mjs > $T/src/simulator.mjs
sed 's#../contract/managed/contract/index.js#../../managed/contract/index.js#g' ../test/punchcard.test.mjs > $T/test/punchcard.test.mjs
node --test $T/test/*.mjs
