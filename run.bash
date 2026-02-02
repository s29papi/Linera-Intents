#!/usr/bin/env bash

set -eu

# Run Linera GraphQL service against the testnet using the relayer wallet.
# Use the host-provided files mounted at /build.
export LINERA_STORAGE="rocksdb:/build/wallet.db"
export LINERA_KEYSTORE="/build/relayer_keystore.json"

: "${FAUCET_URL:?Set FAUCET_URL (e.g. https://faucet.testnet-conway.linera.net)}"
: "${CHAIN_ID:?Set CHAIN_ID to the target chain (e.g. 761f62d7...)}"

# Always re-initialize from the faucet to get a fresh genesis config/admin chain.
rm -rf /build/wallet.db /build/chain.json
mkdir -p /build/wallet.db

# wallet init creates a keystore; temporarily move the relayer keystore out of the way.
if [ -f /build/relayer_keystore.json ]; then
  mv /build/relayer_keystore.json /build/relayer_keystore.json.bak
fi

linera --wallet "/build/chain.json" wallet init --faucet "$FAUCET_URL"

# Restore relayer keystore so request-chain uses the relayer key.
if [ -f /build/relayer_keystore.json.bak ]; then
  mv /build/relayer_keystore.json.bak /build/relayer_keystore.json
fi

linera --wallet "/build/chain.json" wallet follow-chain "$CHAIN_ID" --sync

linera --wallet "/build/chain.json" service --port 8080
