Linera-Intents Wave6
=====================

## Why Linera ?

We chose Linera because our system is intentionally a single-chain design with multiple apps on that chain. The token factory, matching engine, faucet, and per-token fungible apps all run on the same chain and interact via app-level calls, so intent sequencing is deterministic without cross-chain messaging. Scaling in this architecture comes from creating new token app instances from a single fungible-token module (compiled once, reused many times), and deploying them on new chains as demand increases, which is well fitting the crosschain communication between apps. Users do not need personal chains; they send authenticated requests and the operator includes them in blocks, while escrow and settlement rules are enforced in app state on the same chain. This matches our flow: create token, create pool, buy/sell/escrow, all on one chain with clear ownership and liveness.

## What we built and why we built it on linera.

We built a Linera intents system and demonstrated it as a token launchpad. Under the hood, it consists of a token factory, matching engine, faucet, and per-token fungible apps that all run on the same Linera chain. The token factory publishes one fungible-token module and creates a new token app instance per symbol, enforcing unique symbols and fixed bonding-curve parameters. The matching engine creates the pool for each token and handles buy/sell plus escrowed intent settlement, all in wLin, while the faucet mints a capped amount of wLin per user. This structure keeps all state transitions on one chain, so app-level calls are fast and deterministic and do not require cross-chain messaging for pool creation or trading.

We built it this way because Linera lets multiple apps live on a single chain while still allowing the system to scale by adding new token app instances. Users do not need personal chains; they submit authenticated requests that the operator includes in blocks, and the contracts enforce escrow and settlement rules directly in app state.

### Demo video:

## Deliverables

## Whats Next ?

- Host the app to provide a stable live URL.
- Continue product development driven by real user needs and feedback.

