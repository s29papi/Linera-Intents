Linera-Intents Wave6
=====================

## Why Linera ?

We chose Linera because our system is intentionally a single-chain design with multiple apps on that chain. The token factory, matching engine, faucet, and per-token fungible apps all run on the same chain and interact via app-level calls, so intent sequencing is deterministic without cross-chain messaging. Scaling in this architecture comes from creating new token app instances from a single fungible-token module (compiled once, reused many times), and deploying them on new chains as demand increases, which is well fitting the crosschain communication between apps. Users do not need personal chains; they send authenticated requests and the operator includes them in blocks, while escrow and settlement rules are enforced in app state on the same chain. This matches our flow: create token, create pool, buy/sell/escrow, all on one chain with clear ownership and liveness.

## What we built and why we built it on linera.

We built a Linera intents system and demonstrated it as a token launchpad. Under the hood, it consists of a token factory, matching engine, faucet, and per-token fungible apps that all run on the same Linera chain. The token factory publishes one fungible-token module and creates a new token app instance per symbol, enforcing unique symbols and fixed bonding-curve parameters. The matching engine creates the pool for each token and handles buy/sell plus escrowed intent settlement, all in wLin, while the faucet mints a capped amount of wLin per user. This structure keeps all state transitions on one chain, so app-level calls are fast and deterministic and do not require cross-chain messaging for pool creation or trading.

We built it this way because Linera lets multiple apps live on a single chain while still allowing the system to scale by adding new token app instances. Users do not need personal chains; they submit authenticated requests that the operator includes in blocks, and the contracts enforce escrow and settlement rules directly in app state.

### Demo video:

## Deliverables

### Testnet Deployments

- `Testnet CHAIN_ID` — `761f62d709008c57a8eafb9d374522aa13f0a87b68ec4221861c73e0d1b67ced`
- `TOKEN_FACTORY_APP_ID` — `ff081619d9553ae6919dd0ed2268cd1ad988140275701136fe54805d31027990`
- `MATCHING_ENGINE_APP_ID` — `d3f86c75ffb1f389531b93def776a4de877e4b23ea58b348746f4fce910a31be`
- `FAUCET_APP_ID` — `5531238ece651244a3dfab368d5f9ae7c0fe5641c2fc70384e75ef3a427fd1f1`
- `WLIN_APP_ID` — `6a570896ff23d7a1db44398bae8b2ad12101af56cd244a7d694ed94ead048731`

### Architecture

```mermaid
flowchart LR
  %% --- Client side ---
  U[User] --> FE[Next.js Frontend\nLaunchpad / Explore / Token Details]
  U --> MM[MetaMask\nsecp256k1 signatures]

  FE -->|connect + sign payloads| MM

  %% --- Backend entrypoint ---
  FE -->|HTTP GraphQL :8080\nqueries + mutations| GQL[Linera GraphQL Service\n`linera service`]

  %% --- Linera runtime / storage / network ---
  GQL -->|reads/writes local state| DB[(RocksDB\nwallet.db / table_linera)]
  GQL -->|sync certs/blobs\n(quorum)| VALS[(Linera Testnet Validators)]

  %% --- On-chain: single chain hosting multiple apps ---
  subgraph CHAIN["Linera Testnet Chain\nCHAIN_ID = 761f62...67ced"]
    direction TB

    TF[Token Factory Contract\n(createToken)]
    ME[Matching Engine Contract\n(pool + buy/sell settlement)]
    WLIN[WLIN Fungible Token Contract\n(mint/transfer/approve)]
    TOK[Per-Token Fungible Token Contract\n(one app instance per symbol)]
  end

  %% --- How the service reaches contracts ---
  GQL --> TF
  GQL --> ME
  GQL --> WLIN
  GQL --> TOK

  %% --- Create token path ---
  FE -->|createToken\n(name/symbol/params + signature)| GQL
  TF -->|publish module once\ncreate per-token app instance| TOK
  TF -->|register symbol -> tokenAppId\nstore pool config| ME

  %% --- Faucet path (wLin) ---
  FE -->|faucet claim\n(signature)| GQL
  GQL -->|mint capped wLin\n(to user)| WLIN

  %% --- Trade path (wLin <-> token) ---
  FE -->|approve wLin spend\n(signature)| GQL
  GQL -->|approve(owner->spender)\nspender = Matching Engine appId| WLIN

  FE -->|trade BUY/SELL\n(amountIn + minOut + signature)| GQL
  ME -->|checks allowance\nand transfers in/out| WLIN
  ME -->|transfers/mints token out\nor transfers token in| TOK

  %% --- Demo persistence (repo-backed) ---
  FE -->|save token metadata + image| API1[/Next API\n/api/tokens/]
  FE -->|append sampled spot prices| API2[/Next API\n/api/prices/]
  API1 --> FS1[(tokens.gallery.json)]
  API2 --> FS2[(prices.series.json)]
```

## Whats Next ?

- Host the app to provide a stable live URL.
- Continue product development driven by real user needs and feedback.
