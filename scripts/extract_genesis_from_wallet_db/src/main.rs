use std::{fs, path::PathBuf};

use anyhow::{anyhow, Context as _, Result};
use clap::Parser;
use linera_base::{
    crypto::CryptoHash,
    data_types::{ChainDescription, ChainOrigin, Timestamp},
    identifiers::{BlobId, BlobType, ChainId},
};
use linera_execution::committee::Committee;
use linera_storage::{DbStorage, Storage};
use linera_views::{
    lru_caching::{LruCachingConfig, DEFAULT_STORAGE_CACHE_CONFIG},
    rocks_db::{
        PathWithGuard, RocksDbDatabase, RocksDbSpawnMode, RocksDbStoreInternalConfig,
        RocksDbStoreConfig,
    },
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Parser)]
#[command(
    name = "extract-genesis-from-wallet-db",
    about = "Reconstruct a GenesisConfig JSON from a Linera RocksDB wallet.db namespace"
)]
struct Args {
    /// Linera storage config string (RocksDB only), same format as `linera --storage ...`.
    ///
    /// Example: rocksdb:/build/wallet.db:spawn_blocking:default
    #[arg(long)]
    storage: String,

    /// Network name to write into the output genesis.json.
    ///
    /// If omitted, we will use the NetworkDescription (if present), otherwise try to infer it from
    /// validator hostnames (e.g. `validator-1.testnet-conway.linera.net` -> `testnet-conway`).
    #[arg(long)]
    network_name: Option<String>,

    /// Output path for the reconstructed genesis.json. If omitted, prints to stdout.
    #[arg(long)]
    out: Option<PathBuf>,
}

/// Keep the JSON shape compatible with `linera storage initialize --genesis <file>`.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct GenesisConfigJson {
    committee: Committee,
    timestamp: Timestamp,
    chains: Vec<ChainDescription>,
    network_name: String,
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    let args = Args::parse();

    let (config, namespace) = parse_rocksdb_storage(&args.storage)?;
    let blob_ids = DbStorage::<RocksDbDatabase>::list_blob_ids(&config, &namespace)
        .await
        .context("listing blob IDs (is the DB locked by another process?)")?;
    let storage: DbStorage<RocksDbDatabase> =
        DbStorage::connect(&config, &namespace, /* wasm_runtime */ None).await?;

    let genesis = extract_genesis(&storage, &blob_ids, args.network_name).await?;
    let json = serde_json::to_string_pretty(&genesis)?;

    match args.out {
        Some(path) => {
            fs::write(&path, json.as_bytes()).with_context(|| format!("writing {}", path.display()))?;
        }
        None => {
            println!("{json}");
        }
    }

    Ok(())
}

fn parse_rocksdb_storage(spec: &str) -> Result<(RocksDbStoreConfig, String)> {
    // The Linera CLI uses a colon-separated format:
    //   rocksdb:/path/to/wallet.db:spawn_blocking:namespace
    // We intentionally only support RocksDB here.
    let parts: Vec<&str> = spec.split(':').collect();
    if parts.len() < 2 {
        return Err(anyhow!("invalid --storage (expected rocksdb:/path[:spawn_mode][:namespace])"));
    }
    let backend = parts[0];
    if backend != "rocksdb" {
        return Err(anyhow!(
            "unsupported --storage backend {backend:?} (this tool supports rocksdb only)"
        ));
    }

    let path = parts[1];
    if path.is_empty() {
        return Err(anyhow!("invalid --storage: empty rocksdb path"));
    }

    let spawn_mode = match parts.get(2).copied() {
        None => RocksDbSpawnMode::get_spawn_mode_from_runtime(),
        Some("spawn_blocking") => RocksDbSpawnMode::SpawnBlocking,
        Some("block_in_place") => RocksDbSpawnMode::BlockInPlace,
        Some(other) => return Err(anyhow!("invalid rocksdb spawn mode {other:?}")),
    };

    let namespace = parts.get(3).copied().unwrap_or("default").to_string();
    if let Some(extra) = parts.get(4) {
        return Err(anyhow!(
            "invalid --storage: unexpected extra segment {extra:?} (expected 4 segments max)"
        ));
    }

    let inner_config = RocksDbStoreInternalConfig {
        path_with_guard: PathWithGuard::new(PathBuf::from(path)),
        spawn_mode,
        max_stream_queries: 10,
    };
    let config = LruCachingConfig {
        inner_config,
        storage_cache_config: DEFAULT_STORAGE_CACHE_CONFIG,
    };

    Ok((config, namespace))
}

async fn extract_genesis<S: Storage + Clone + Send + Sync + 'static>(
    storage: &S,
    blob_ids: &[BlobId],
    explicit_network_name: Option<String>,
) -> Result<GenesisConfigJson> {
    let network_description = storage.read_network_description().await?;

    let (genesis_timestamp, chains) =
        extract_root_chain_descriptions(storage, blob_ids).await?;

    let committee = extract_committee(storage, blob_ids, network_description.as_ref()).await?;

    let network_name = match (
        explicit_network_name,
        network_description.as_ref().map(|d| d.name.clone()),
    ) {
        (Some(name), _) => name,
        (None, Some(name)) => name,
        (None, None) => infer_network_name_from_committee(&committee).ok_or_else(|| {
            anyhow!(
                "storage has no NetworkDescription and --network-name not provided (unable to infer)"
            )
        })?,
    };

    Ok(GenesisConfigJson {
        committee,
        timestamp: genesis_timestamp,
        chains,
        network_name,
    })
}

async fn extract_root_chain_descriptions<S: Storage + Clone + Send + Sync + 'static>(
    storage: &S,
    blob_ids: &[BlobId],
) -> Result<(Timestamp, Vec<ChainDescription>)> {
    let mut roots: Vec<(ChainId, ChainDescription)> = Vec::new();
    let mut root0_candidates: Vec<(ChainId, ChainDescription)> = Vec::new();

    for blob_id in blob_ids {
        if blob_id.blob_type != BlobType::ChainDescription {
            continue;
        }
        let Some(blob) = storage.read_blob(*blob_id).await? else {
            continue;
        };
        let Ok(desc) = bcs::from_bytes::<ChainDescription>(blob.bytes()) else {
            continue;
        };
        if !matches!(desc.origin(), ChainOrigin::Root(_)) {
            continue;
        }

        let chain_id = ChainId(blob_id.hash);

        if matches!(desc.origin(), ChainOrigin::Root(0)) {
            root0_candidates.push((chain_id, desc.clone()));
        }
        roots.push((chain_id, desc));
    }

    if root0_candidates.is_empty() {
        return Err(anyhow!("no Root(0) ChainDescription blob found in storage"));
    }

    // If multiple Root(0) chains exist (e.g. multiple networks copied into one DB), pick the most
    // recent by timestamp.
    root0_candidates.sort_by_key(|(_, d)| d.timestamp());
    let (_admin_chain_id, admin_desc) = root0_candidates
        .last()
        .cloned()
        .expect("non-empty");

    let genesis_timestamp = admin_desc.timestamp();

    let mut chains: Vec<ChainDescription> = roots
        .into_iter()
        .filter(|(_, d)| d.timestamp() == genesis_timestamp)
        .map(|(_, d)| d)
        .collect();

    chains.sort_by_key(|d| root_index(&d.origin()).unwrap_or(u32::MAX));

    Ok((genesis_timestamp, chains))
}

async fn extract_committee<S: Storage + Clone + Send + Sync + 'static>(
    storage: &S,
    blob_ids: &[BlobId],
    network_description: Option<&linera_base::data_types::NetworkDescription>,
) -> Result<Committee> {
    // Prefer the committee blob that NetworkDescription points to (if present).
    if let Some(desc) = network_description {
        let blob_id = BlobId {
            blob_type: BlobType::Committee,
            hash: desc.genesis_committee_blob_hash,
        };
        if let Some(blob) = storage.read_blob(blob_id).await? {
            let committee: Committee = bcs::from_bytes(blob.bytes())
                .context("decoding Committee (bcs) from committee blob bytes")?;
            return Ok(committee);
        }
    }

    // Fallback: scan committee blobs and pick the most "likely" one. In practice this tends to be
    // the committee with the most validators and votes.
    let mut best: Option<(usize, u64, Committee)> = None;
    for blob_id in blob_ids {
        if blob_id.blob_type != BlobType::Committee {
            continue;
        }
        let Some(blob) = storage.read_blob(*blob_id).await? else {
            continue;
        };
        let Ok(committee) = bcs::from_bytes::<Committee>(blob.bytes()) else {
            continue;
        };
        let validators = committee.validators.len();
        let votes_sum: u64 = committee.validators.values().map(|v| v.votes).sum();
        match &best {
            None => best = Some((validators, votes_sum, committee)),
            Some((best_v, best_votes, _))
                if (validators, votes_sum) > (*best_v, *best_votes) =>
            {
                best = Some((validators, votes_sum, committee));
            }
            _ => {}
        }
    }

    best.map(|(_, _, c)| c)
        .ok_or_else(|| anyhow!("no Committee blobs could be decoded from storage"))
}

fn infer_network_name_from_committee(committee: &Committee) -> Option<String> {
    // Try to infer from `validator-*.{network}.linera.net` hostnames.
    let mut candidate: Option<String> = None;
    for v in committee.validators.values() {
        let addr = v.network_address.as_str();
        let Some(idx) = addr.find("testnet-") else {
            continue;
        };
        let rest = &addr[idx..];
        let end = rest.find('.').unwrap_or(rest.len());
        let name = rest[..end].to_string();
        match &candidate {
            None => candidate = Some(name),
            Some(prev) if prev == &name => {}
            Some(_) => return None,
        }
    }
    candidate
}

fn root_index(origin: &ChainOrigin) -> Option<u32> {
    match origin {
        ChainOrigin::Root(i) => Some(*i),
        ChainOrigin::Child { .. } => None,
    }
}

// Helper: build a ChainId from a ChainDescription blob hash (ChainDescription uses ChainId == hash).
#[allow(dead_code)]
fn chain_id_from_blob_hash(hash: CryptoHash) -> ChainId {
    ChainId(hash)
}
