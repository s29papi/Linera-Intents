#!/usr/bin/env bash
set -euo pipefail

# CLI walkthrough based on your recorded commands.

# --- Shared variables (edit these as you go) ---
WALLET="/home/usih/.config/linera/wallet.json"
CHAIN_ID="761f62d709008c57a8eafb9d374522aa13f0a87b68ec4221861c73e0d1b67ced"
OWNER="0x49c2f87001ec3e39ea5a4dbd115e404c4d4a4641e83c9a60dc3d9e77778f72c1"
FEE_DESTINATION="$OWNER"
TOKEN_NAME="${TOKEN_NAME:-Test}"
TOKEN_SYMBOL="${TOKEN_SYMBOL:-TST}"
TOKEN_DECIMALS="${TOKEN_DECIMALS:-9}"
TOKEN_INITIAL_SUPPLY="${TOKEN_INITIAL_SUPPLY:-800000000}"
WALLET_USER2="./wallets/user2_wallet.json"
KEYSTORE_USER2="./wallets/user2_keystore.json"
OWNER_USER2="0x6e937d765dd86d832ccb5b0272a6d1297127d462bb98c6e57f8fb20954d6c4c4"

# Module IDs (fill from publish-module output)
FUNGIBLE_MODULE_ID="c306bd570e7bc2fea17a5faf77ae5c433b707b1ed2ca122b5ae94b096e4c7d3b9f77b15a64aee773670551cc9c6ca9d69c28b3ff153884b40ff48edb6e31ff1600"
TOKEN_FACTORY_MODULE_ID="c571ed5ec08d5dff76e39fe20ba5c85d4e745faad8266c11cfe9da3f6f355de95088ff5b4833c10ca552ad12f1e83508b98cc9809e415c7a13a2385d3b060bff00"
FAUCET_MODULE_ID="d1b3fb3991aa9070a35ac39f48862b6ab6bbc7679a29bb4814455dae355c76768c9456afd822b1ebbead163212ab7a142d9cbbcd34df37872e6e38231043da2000"
MATCHING_ENGINE_MODULE_ID="4ad1e2e422d43b38f9b561d928c0cb87516b9dc65187bca00eb7795c8c5613f16cc644cee828acc989122e89e101b2240362a0f6ae475c519fc30baf562c283300"

# App IDs (fill from create-application output)
TOKEN_FACTORY_APP_ID="ff081619d9553ae6919dd0ed2268cd1ad988140275701136fe54805d31027990"
MATCHING_ENGINE_APP_ID="d3f86c75ffb1f389531b93def776a4de877e4b23ea58b348746f4fce910a31be"
FAUCET_APP_ID="5531238ece651244a3dfab368d5f9ae7c0fe5641c2fc70384e75ef3a427fd1f1"
WLIN_APP_ID="6a570896ff23d7a1db44398bae8b2ad12101af56cd244a7d694ed94ead048731"
TST_APP_ID="5b0d02cccfeee39d79b035f27fb61ced602c7cfe3b32661831520e009e5cad15"

# Signatures (fill from scripts/sign_create_token)
CREATE_TOKEN_SIG="003804e6092410173ca440e60265daf8240ba12f81102ffce32f2d0f40cd8eb574f78ac8580437398b94d61354deeeff017fadcd4018691fdef3c767c554c12d00f30b8cc9ed206443cbe13949259caec51fb694ad09d8c4994f880d9260143973"
WLIN_APPROVE_SIG="00a628560d3a6891911f5b18214d5159e4026fff87a9dd6eeb0fc4f6c780fbe6ecb8003cd716e264f1e5fa76315754a3c7464d1444678914e24dc6c524f61b490cf30b8cc9ed206443cbe13949259caec51fb694ad09d8c4994f880d9260143973"
TST_APPROVE_SIG="00a628560d3a6891911f5b18214d5159e4026fff87a9dd6eeb0fc4f6c780fbe6ecb8003cd716e264f1e5fa76315754a3c7464d1444678914e24dc6c524f61b490cf30b8cc9ed206443cbe13949259caec51fb694ad09d8c4994f880d9260143973"
BUY_SIG="00ad940203d3e235dd3e3cd20b3c9d625afe74046e498d612212f83befb0b292f377766ec2d54abcac9a8ff40041b0d7b1b9aa0e4c56f52c9ac785be30b6ce740cf30b8cc9ed206443cbe13949259caec51fb694ad09d8c4994f880d9260143973"
SELL_SIG="007cb8d11b1b71ffacc0a76f20e304dc05cf79f4c770279860ee768d4aeba9a7cbc9c17e9ccc8a0f7b5d38f44e477e7c2c272bf8b0e598f2d7f4948d90441d820ff30b8cc9ed206443cbe13949259caec51fb694ad09d8c4994f880d9260143973"
CREATE_TOKEN_SIG_USER2="00359c4b171aa0081167d479b3ea5f4a445b2af9f6981ea860b342c064b5326a1432b4bb58d22e89c3a38b10181c810ce6faa87d8699837b0a4fddc9d8cca6d90777618bfc77ce17e46fe3d7c9fb9f5a983eb527ee7bec09fb544bc612b9f6f0a6"
WLIN_APPROVE_SIG_USER2="0085c21ede00765f25e72063b0ef248f255caf26d304acdf1cc0baaa47901e3e1f301efcd4d74a53924a7e094a999078a4ae043da006954f97d21322157be73c0577618bfc77ce17e46fe3d7c9fb9f5a983eb527ee7bec09fb544bc612b9f6f0a6"
TST_APPROVE_SIG_USER2="0085c21ede00765f25e72063b0ef248f255caf26d304acdf1cc0baaa47901e3e1f301efcd4d74a53924a7e094a999078a4ae043da006954f97d21322157be73c0577618bfc77ce17e46fe3d7c9fb9f5a983eb527ee7bec09fb544bc612b9f6f0a6"
BUY_SIG_USER2="00159a3bdd2d5ae2f39225b668aef72e917ae54bf11dc71c522a0084bfb57bb32dbbe78cd58906f10eee98f94ad55666e4409fbe3454745bac50ae80968b216a0d77618bfc77ce17e46fe3d7c9fb9f5a983eb527ee7bec09fb544bc612b9f6f0a6"
SELL_SIG_USER2="00702cd3e81c9ff63e5a4a9135fb6eb4099d1df6fbe78fc8050219866ad3dc3c7ad29638b9ff5f263bbf50ceed24503bc0736f95dbadc5748100b5b0cc99a3840c77618bfc77ce17e46fe3d7c9fb9f5a983eb527ee7bec09fb544bc612b9f6f0a6"
INTENT_SIG="__INTENT_SIG__"
INTENT_ID="__INTENT_ID__"
FILL_AMOUNT="${FILL_AMOUNT:-0}"

case "${1:-}" in
  user2-init)
    # --- Create user2 keypair (in-repo, independent of linera keygen) ---
    cargo run --manifest-path scripts/gen_keypair/Cargo.toml
    ;;
  user2-mint)
    # --- Faucet mint wLin for user2 (signed by user2) ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$FAUCET_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { faucetMint(amount: \\\"1000\\\", owner: \\\"$OWNER_USER2\\\") }\"}"
    ;;
  build)
    # --- Build/compile (WASM outputs) ---
    cargo build --manifest-path intents-chain/fungible_token/Cargo.toml --release --target wasm32-unknown-unknown
    cargo build --manifest-path intents-chain/matching_engine/Cargo.toml --release --target wasm32-unknown-unknown
    cargo build --manifest-path intents-chain/shared_types/Cargo.toml --release --target wasm32-unknown-unknown
    cargo build --manifest-path intents-chain/faucet/Cargo.toml --release --target wasm32-unknown-unknown
    cargo build --manifest-path intents-chain/token_factory/Cargo.toml --release --target wasm32-unknown-unknown
    ;;
  publish)
    # --- Publish modules (contract + service) ---
    linera --wallet "$WALLET" publish-module \
      "intents-chain/target/wasm32-unknown-unknown/release/fungible_token_contract.wasm" \
      "intents-chain/target/wasm32-unknown-unknown/release/fungible_token_service.wasm" \
      "$CHAIN_ID"

    linera --wallet "$WALLET" publish-module \
      "intents-chain/target/wasm32-unknown-unknown/release/token_factory_contract.wasm" \
      "intents-chain/target/wasm32-unknown-unknown/release/token_factory_service.wasm" \
      "$CHAIN_ID"

    linera --wallet "$WALLET" publish-module \
      "intents-chain/target/wasm32-unknown-unknown/release/faucet_contract.wasm" \
      "intents-chain/target/wasm32-unknown-unknown/release/faucet_service.wasm" \
      "$CHAIN_ID"

    linera --wallet "$WALLET" publish-module \
      "intents-chain/target/wasm32-unknown-unknown/release/matching_engine_contract.wasm" \
      "intents-chain/target/wasm32-unknown-unknown/release/matching_engine_service.wasm" \
      "$CHAIN_ID"
    ;;
  apps)
    # --- Create app instances (ModuleId -> AppId) ---
    linera --wallet "$WALLET" create-application "$TOKEN_FACTORY_MODULE_ID" "$CHAIN_ID"
    linera --wallet "$WALLET" create-application "$MATCHING_ENGINE_MODULE_ID" "$CHAIN_ID"
    linera --wallet "$WALLET" create-application "$FAUCET_MODULE_ID" "$CHAIN_ID"
    ;;
  wlin)
    # --- Create wLin fungible app (returns wLin app id) ---
    linera --wallet "$WALLET" create-application \
      "$FUNGIBLE_MODULE_ID" \
      --json-parameters "{\"ticker_symbol\":\"wLin\",\"minter_app_id\":\"$FAUCET_APP_ID\",\"trusted_caller_app_id\":\"$MATCHING_ENGINE_APP_ID\"}" \
      --json-argument '{"balances":[]}' \
      "$CHAIN_ID"
    ;;
  service)
    # --- Start GraphQL service (separate terminal recommended) ---
    linera --wallet "$WALLET" service --port 8080
    ;;
  setup)
    # --- Wire apps together (matching_engine + token_factory + faucet) ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$TOKEN_FACTORY_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { setMatchingEngine(appId: \\\"$MATCHING_ENGINE_APP_ID\\\") }\"}"

    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$TOKEN_FACTORY_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { setModule(moduleId: \\\"$FUNGIBLE_MODULE_ID\\\") }\"}"

    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$MATCHING_ENGINE_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { setWlinApp(appId: \\\"$WLIN_APP_ID\\\") }\"}"

    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$MATCHING_ENGINE_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { setFeeDestination(owner: \\\"$FEE_DESTINATION\\\") }\"}"

    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$FAUCET_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { setWlinApp(appId: \\\"$WLIN_APP_ID\\\") }\"}"

    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$FAUCET_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw '{"query":"mutation { setFaucetCap(amount: \"1000000000000\") }"}'
    ;;
  create-token)
    # --- Create token (auto-creates pool in matching_engine) ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$TOKEN_FACTORY_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { createToken(request: { payload: { owner: \\\"$OWNER\\\", metadata: { name: \\\"$TOKEN_NAME\\\", symbol: \\\"$TOKEN_SYMBOL\\\", decimals: $TOKEN_DECIMALS }, initialSupply: \\\"$TOKEN_INITIAL_SUPPLY\\\" }, signatureHex: \\\"$CREATE_TOKEN_SIG\\\" }) }\"}"
    ;;
  create-token-user2)
    # --- Create token as user2 ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$TOKEN_FACTORY_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { createToken(request: { payload: { owner: \\\"$OWNER_USER2\\\", metadata: { name: \\\"$TOKEN_NAME\\\", symbol: \\\"$TOKEN_SYMBOL\\\", decimals: $TOKEN_DECIMALS }, initialSupply: \\\"$TOKEN_INITIAL_SUPPLY\\\" }, signatureHex: \\\"$CREATE_TOKEN_SIG_USER2\\\" }) }\"}"
    ;;
  mint)
    # --- Faucet mint wLin (requires signer) ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$FAUCET_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { faucetMint(amount: \\\"1000\\\", owner: \\\"$OWNER\\\") }\"}"
    ;;
  approve)
    # --- Approve wLin + TST for matching_engine ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$WLIN_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { approve(request: { payload: { owner: \\\"$OWNER\\\", spender: \\\"0x$MATCHING_ENGINE_APP_ID\\\", allowance: \\\"1000\\\" }, signatureHex: \\\"$WLIN_APPROVE_SIG\\\" }) }\"}"

    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$TST_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { approve(request: { payload: { owner: \\\"$OWNER\\\", spender: \\\"0x$MATCHING_ENGINE_APP_ID\\\", allowance: \\\"1000\\\" }, signatureHex: \\\"$TST_APPROVE_SIG\\\" }) }\"}"
    ;;
  approve-user2)
    # --- Approve wLin + TST for matching_engine (user2) ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$WLIN_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { approve(request: { payload: { owner: \\\"$OWNER_USER2\\\", spender: \\\"0x$MATCHING_ENGINE_APP_ID\\\", allowance: \\\"1000\\\" }, signatureHex: \\\"$WLIN_APPROVE_SIG_USER2\\\" }) }\"}"

    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$TST_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { approve(request: { payload: { owner: \\\"$OWNER_USER2\\\", spender: \\\"0x$MATCHING_ENGINE_APP_ID\\\", allowance: \\\"1000\\\" }, signatureHex: \\\"$TST_APPROVE_SIG_USER2\\\" }) }\"}"
    ;;
  buy)
    # --- Buy TST ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$MATCHING_ENGINE_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { buy(trade: { payload: { owner: \\\"$OWNER\\\", symbol: \\\"$TOKEN_SYMBOL\\\", side: BUY, amount: \\\"10\\\", minOut: \\\"1\\\" }, signatureHex: \\\"$BUY_SIG\\\" }) }\"}"
    ;;
  buy-user2)
    # --- Buy TST (user2) ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$MATCHING_ENGINE_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { buy(trade: { payload: { owner: \\\"$OWNER_USER2\\\", symbol: \\\"$TOKEN_SYMBOL\\\", side: BUY, amount: \\\"10\\\", minOut: \\\"1\\\" }, signatureHex: \\\"$BUY_SIG_USER2\\\" }) }\"}"
    ;;
  sell)
    # --- Sell TST ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$MATCHING_ENGINE_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { sell(trade: { payload: { owner: \\\"$OWNER\\\", symbol: \\\"$TOKEN_SYMBOL\\\", side: SELL, amount: \\\"10\\\", minOut: \\\"1\\\" }, signatureHex: \\\"$SELL_SIG\\\" }) }\"}"
    ;;
  sell-user2)
    # --- Sell TST (user2) ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$MATCHING_ENGINE_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { sell(trade: { payload: { owner: \\\"$OWNER_USER2\\\", symbol: \\\"$TOKEN_SYMBOL\\\", side: SELL, amount: \\\"10\\\", minOut: \\\"1\\\" }, signatureHex: \\\"$SELL_SIG_USER2\\\" }) }\"}"
    ;;
  place-intent)
    # --- Place intent (escrow) for OWNER ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$MATCHING_ENGINE_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { placeIntent(intent: { payload: { owner: \\\"$OWNER\\\", symbol: \\\"$TOKEN_SYMBOL\\\", side: SELL, amount: \\\"10\\\", limitPrice: \\\"0.001\\\" }, signatureHex: \\\"$INTENT_SIG\\\" }) }\"}"
    ;;
  settle-intent)
    # --- Settle intent (operator) ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$MATCHING_ENGINE_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"mutation { settleIntent(intentId: \\\"$INTENT_ID\\\", fillAmount: \\\"$FILL_AMOUNT\\\") }\"}"
    ;;
  balances-user2)
    # --- Check user2 balances (wLin + current token) ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$WLIN_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"query { balance(owner: \\\"$OWNER_USER2\\\") }\"}"

    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$TST_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"query { balance(owner: \\\"$OWNER_USER2\\\") }\"}"
    ;;
  balances)
    # --- Check user balances (wLin + current token) ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$WLIN_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"query { balance(owner: \\\"$OWNER\\\") }\"}"

    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$TST_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"query { balance(owner: \\\"$OWNER\\\") }\"}"
    ;;
  quote)
    # --- Quote expected output and a safe minOut for current pool ---
    QUOTE_JSON=$(curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$MATCHING_ENGINE_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"query { poolConfig(symbol: \\\"$TOKEN_SYMBOL\\\") { totalCurveSupply initialPrice graduationBaseReserve feeBps vX vY } wlinReserve(symbol: \\\"$TOKEN_SYMBOL\\\") tokenReserve(symbol: \\\"$TOKEN_SYMBOL\\\") }\"}")

    python3 - "$QUOTE_JSON" <<'PY'
import json, sys, decimal
data = json.loads(sys.argv[1]).get("data") or {}
cfg = data.get("poolConfig") or {}
wlin = data.get("wlinReserve") or "0"
token = data.get("tokenReserve") or "0"
fee_bps = int(cfg.get("feeBps") or 0)
v_x = decimal.Decimal(str(cfg.get("vX") or "0"))
v_y = decimal.Decimal(str(cfg.get("vY") or "0"))

# Amount::from_tokens(n) -> n * 1e18 attos in Linera
ATTOS = 10**18
def to_attos(s): return int(decimal.Decimal(str(s)) * ATTOS)

amount_in = to_attos("10")  # matches default buy amount in cli.sh

x = to_attos(wlin) + int(v_x * ATTOS)
y = to_attos(token) + int(v_y * ATTOS)
fee = amount_in * fee_bps // 10000
dx = amount_in - fee

# buy: y_out = (y) - k / (x + dx)
k = x * y
y_out = y - (k // (x + dx))

token_out = y_out
print(json.dumps({
    "wlin_reserve": wlin,
    "token_reserve": token,
    "fee_bps": fee_bps,
    "expected_token_out": str(decimal.Decimal(token_out) / ATTOS),
    "suggested_min_out": str(decimal.Decimal(token_out) / ATTOS * decimal.Decimal("0.99")),
}, indent=2))
PY
    ;;
  token-app-id)
    # --- Fetch TST app id from token_factory ---
    curl -s "http://127.0.0.1:8080/chains/$CHAIN_ID/applications/$TOKEN_FACTORY_APP_ID" \
      -H 'Content-Type: application/json' \
      --data-raw "{\"query\":\"query { tokenAppId(symbol: \\\"$TOKEN_SYMBOL\\\") }\"}"
    ;;
esac
