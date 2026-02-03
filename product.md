# Product Inputs (Frontend Integration)

This file lists non-signature inputs used by the CLI for: mint, approve, create token, buy, sell. These values are required to build frontend requests; signature generation is intentionally excluded.

## Shared / Core Values (Filled from scripts/cli.sh)
- CHAIN_ID — `761f62d709008c57a8eafb9d374522aa13f0a87b68ec4221861c73e0d1b67ced`
- OWNER — `0x49c2f87001ec3e39ea5a4dbd115e404c4d4a4641e83c9a60dc3d9e77778f72c1`
- OWNER_USER2 — `0x6e937d765dd86d832ccb5b0272a6d1297127d462bb98c6e57f8fb20954d6c4c4`
- TOKEN_NAME — default `Test`
- TOKEN_SYMBOL — default `TST`
- TOKEN_DECIMALS — default `9`
- TOKEN_INITIAL_SUPPLY — default `800000000`
- TOKEN_FACTORY_APP_ID — `ff081619d9553ae6919dd0ed2268cd1ad988140275701136fe54805d31027990`
- MATCHING_ENGINE_APP_ID — `d3f86c75ffb1f389531b93def776a4de877e4b23ea58b348746f4fce910a31be`
- FAUCET_APP_ID — `5531238ece651244a3dfab368d5f9ae7c0fe5641c2fc70384e75ef3a427fd1f1`
- WLIN_APP_ID — `6a570896ff23d7a1db44398bae8b2ad12101af56cd244a7d694ed94ead048731`
- TST_APP_ID — `5b0d02cccfeee39d79b035f27fb61ced602c7cfe3b32661831520e009e5cad15`
- GRAPHQL_BASE_URL — `http://127.0.0.1:8080`

## Command-Specific Inputs

### 1) Mint (faucetMint)
GraphQL target: `applications/$FAUCET_APP_ID`
- CHAIN_ID
- FAUCET_APP_ID
- OWNER / OWNER_USER2
- amount — `1000`

### 2) Approve (wLin + token)
GraphQL target: `applications/$WLIN_APP_ID` and `applications/$TST_APP_ID`
- CHAIN_ID
- WLIN_APP_ID
- TST_APP_ID
- OWNER / OWNER_USER2
- spender — `0x$MATCHING_ENGINE_APP_ID`
- allowance — `1000`

### 3) Create Token (createToken)
GraphQL target: `applications/$TOKEN_FACTORY_APP_ID`
- CHAIN_ID
- TOKEN_FACTORY_APP_ID
- OWNER / OWNER_USER2
- TOKEN_NAME
- TOKEN_SYMBOL
- TOKEN_DECIMALS
- TOKEN_INITIAL_SUPPLY

### 4) Buy (buy)
GraphQL target: `applications/$MATCHING_ENGINE_APP_ID`
- CHAIN_ID
- MATCHING_ENGINE_APP_ID
- OWNER / OWNER_USER2
- TOKEN_SYMBOL
- side — BUY
- amount — `10`
- minOut — `1`

### 5) Sell (sell)
GraphQL target: `applications/$MATCHING_ENGINE_APP_ID`
- CHAIN_ID
- MATCHING_ENGINE_APP_ID
- OWNER / OWNER_USER2
- TOKEN_SYMBOL
- side — SELL
- amount — `10`
- minOut — `1`

## Notes on Reuse (per CLI)
- CHAIN_ID, OWNER, TOKEN_SYMBOL, MATCHING_ENGINE_APP_ID reused across most actions.
- Approvals always use spender = `0x$MATCHING_ENGINE_APP_ID`.
- Mint/approve/buy/sell depend on correct app IDs.
