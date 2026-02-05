#!/usr/bin/env bash

set -euo pipefail

die() {
  echo "ERROR: $*" >&2
  exit 1
}

ensure_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return 0
  fi

  # Dockerfile installs Node via nvm; ensure it's on PATH for non-interactive shells.
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    . "${NVM_DIR}/nvm.sh"
  fi

  command -v node >/dev/null 2>&1 || die "node not found (nvm not loaded?)"
  command -v npm >/dev/null 2>&1 || die "npm not found (nvm not loaded?)"
}

# Run Linera GraphQL service using host-provided files mounted at /build.
export LINERA_STORAGE="${LINERA_STORAGE:-rocksdb:/tmp/linera-wallet.db}"
USE_EMBEDDED_KEYSTORE="${USE_EMBEDDED_KEYSTORE:-1}"
MIN_KEYSTORE="${MIN_KEYSTORE:-/tmp/relayer_keystore.json}"
HOST_KEYSTORE="${HOST_KEYSTORE:-/build/relayer_keystore.json}"

# Inputs / config.
GENESIS_JSON="${GENESIS_JSON:-/build/genesis.extracted.json}"
CHAIN_ID="${CHAIN_ID:-761f62d709008c57a8eafb9d374522aa13f0a87b68ec4221861c73e0d1b67ced}"

# Embedded proposer key (so we don't need to ship a keystore file in /build).
DEFAULT_OWNER="0x49c2f87001ec3e39ea5a4dbd115e404c4d4a4641e83c9a60dc3d9e77778f72c1"
DEFAULT_PROPOSER_BYTES='[123,34,69,100,50,53,53,49,57,34,58,34,100,53,54,48,102,97,53,98,56,98,97,98,48,56,99,55,53,52,101,97,48,56,52,52,97,100,48,50,57,55,98,97,49,98,48,49,55,101,51,99,98,52,56,99,52,99,55,54,50,57,54,49,52,52,55,49,99,97,100,97,101,53,51,49,34,125]'

OWNER="${OWNER:-${DEFAULT_OWNER}}"

# Frontend (Next.js) - optional.
RUN_FRONTEND="${RUN_FRONTEND:-1}"
FRONTEND_DIR="${FRONTEND_DIR:-/build/frontend}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

# Ephemeral wallet file inside the container.
WALLET_PATH="${WALLET_PATH:-/tmp/chain.json}"
HOST_WALLET_PATH="/build/chain.json"
STORAGE_FULL="${LINERA_STORAGE}:spawn_blocking:table_linera"
TMP_KEYSTORE="/tmp/linera-wallet-init-keystore.json"

cleanup() {
  rm -f "${WALLET_PATH}" "${HOST_WALLET_PATH}" "${TMP_KEYSTORE}" "${MIN_KEYSTORE}" 2>/dev/null || true

  # Keep deletion extra safe: only delete the configured RocksDB directory.
  if [[ "${LINERA_STORAGE}" == rocksdb:* ]]; then
    local db_dir
    db_dir="${LINERA_STORAGE#rocksdb:}"
    if [[ -n "${db_dir}" && "${db_dir}" != "/" && -d "${db_dir}" ]]; then
      rm -rf "${db_dir}"
    fi
  fi
}
trap cleanup EXIT

[[ -f "${GENESIS_JSON}" ]] || die "Missing genesis JSON at ${GENESIS_JSON}"

# Start from a clean slate each run.
cleanup

# Provide the keystore to Linera.
if [[ "${USE_EMBEDDED_KEYSTORE}" == "1" ]]; then
  [[ "${OWNER}" == "${DEFAULT_OWNER}" ]] || die "Embedded keystore only supports OWNER=${DEFAULT_OWNER} (got ${OWNER})."

  printf '{\n  "keys": [\n    [\n      "%s",\n      %s\n    ]\n  ],\n  "prng_seed": null\n}\n' \
    "${DEFAULT_OWNER}" "${DEFAULT_PROPOSER_BYTES}" > "${MIN_KEYSTORE}"

  export LINERA_KEYSTORE="${MIN_KEYSTORE}"
else
  [[ -f "${HOST_KEYSTORE}" ]] || die "Missing keystore at ${HOST_KEYSTORE}"
  export LINERA_KEYSTORE="${HOST_KEYSTORE}"
fi

# Initialize storage from the extracted genesis config.
linera --storage "${STORAGE_FULL}" storage initialize --genesis "${GENESIS_JSON}"

# Create an empty wallet that carries the same genesis_config.
# We use a temporary keystore for this step (the service uses LINERA_KEYSTORE later).
linera --storage "${STORAGE_FULL}" --wallet "${WALLET_PATH}" --keystore "${TMP_KEYSTORE}" \
  wallet init --genesis "${GENESIS_JSON}"
rm -f "${TMP_KEYSTORE}"

# Add the chain we want to operate on into the wallet and sync its state so the wallet metadata
# (latest block hash/height/timestamp) is current.
linera --storage "${STORAGE_FULL}" --wallet "${WALLET_PATH}" wallet follow-chain "${CHAIN_ID}" --sync

# `follow-chain` adds the chain in follow-only mode (owner = null). Force it to the owner we want.
grep -Fq "${OWNER}" "${LINERA_KEYSTORE}" || die "OWNER ${OWNER} is not present in ${LINERA_KEYSTORE}"

CHAIN_ID="${CHAIN_ID}" OWNER="${OWNER}" WALLET_PATH="${WALLET_PATH}" python3 - <<'PY'
import json
import os

wallet_path = os.environ["WALLET_PATH"]
chain_id = os.environ["CHAIN_ID"]
owner = os.environ["OWNER"]

with open(wallet_path, "r", encoding="utf-8") as f:
    data = json.load(f)

chains = data.get("chains")
if not isinstance(chains, dict) or chain_id not in chains:
    raise SystemExit(f"Wallet has no chain entry for {chain_id}")

chains[chain_id]["owner"] = owner

with open(wallet_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, sort_keys=True)
    f.write("\n")
PY

linera --storage "${STORAGE_FULL}" --wallet "${WALLET_PATH}" wallet set-default "${CHAIN_ID}"

svc_pid=""
fe_pid=""

linera --storage "${STORAGE_FULL}" --wallet "${WALLET_PATH}" --keystore "${LINERA_KEYSTORE}" \
  service --port 8080 &
svc_pid="$!"

if [[ "${RUN_FRONTEND}" == "1" ]]; then
  [[ -d "${FRONTEND_DIR}" ]] || die "Missing frontend dir at ${FRONTEND_DIR}"
  ensure_node

  if [[ ! -d "${FRONTEND_DIR}/node_modules" ]]; then
    die "Missing ${FRONTEND_DIR}/node_modules. Run `npm ci` in ./frontend on the host (recommended), then restart."
  fi

  (
    cd "${FRONTEND_DIR}"
    npm run dev:docker -- -p "${FRONTEND_PORT}" -H "${FRONTEND_HOST}"
  ) &
  fe_pid="$!"
fi

if [[ -n "${fe_pid}" ]]; then
  wait -n "${svc_pid}" "${fe_pid}"
  status="$?"
else
  wait "${svc_pid}"
  status="$?"
fi

# If either process exits, stop the other (so `docker compose up` doesn't hang).
if [[ -n "${svc_pid}" ]]; then
  kill "${svc_pid}" 2>/dev/null || true
fi
if [[ -n "${fe_pid}" ]]; then
  kill "${fe_pid}" 2>/dev/null || true
fi

exit "${status}"
