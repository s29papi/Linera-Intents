extract_genesis_from_wallet_db

Reconstructs a Linera `GenesisConfig` JSON ("genesis.json") by reading a RocksDB `wallet.db`
namespace and decoding the stored BCS blobs:

- `NetworkDescription` (if present; used for `network_name` + the canonical genesis committee blob)
- committee blobs (BCS-encoded `Committee`) as a fallback when `NetworkDescription` is missing
- root `ChainDescription` blobs (BCS-encoded `ChainDescription`)

Usage

```bash
./scripts/extract_genesis_from_wallet_db/target/debug/extract_genesis_from_wallet_db \
  --storage "rocksdb:/build/wallet.db:spawn_blocking:default" \
  --out /build/genesis.json \
  --network-name testnet-conway
```

Note: RocksDB uses a `LOCK` file, so this must run when the `wallet.db` namespace isn't already
open by another Linera process (e.g. stop `linera service` / the docker container first).

Or print to stdout:

```bash
./scripts/extract_genesis_from_wallet_db/target/debug/extract_genesis_from_wallet_db \
  --storage "rocksdb:$(pwd)/wallet.db:spawn_blocking:default"
```
