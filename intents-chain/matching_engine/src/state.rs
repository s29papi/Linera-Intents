//! On-chain state for the matching-engine app.
//!
//! This app owns the bonding-curve pools and the escrow/intent book. It interacts
//! with token apps (fungible token instances) and the wLin app via
//! `ContractRuntime::call_application`.

use linera_base::identifiers::ApplicationId;
use linera_sdk::linera_base_types::{AccountOwner, Amount};
use linera_sdk::views::{linera_views, MapView, RegisterView, RootView, ViewStorageContext};

use shared_types::{Intent, IntentId, PoolConfig};

/// Persistent storage for the matching-engine app.
#[derive(RootView)]
#[view(context = ViewStorageContext)]
pub struct MatchingEngineState {
    /// wLin application id used as the pricing asset.
    pub wlin_app_id: RegisterView<Option<ApplicationId>>,
    /// Fee destination for curve fees (operator).
    pub fee_destination: RegisterView<Option<AccountOwner>>,

    /// Token app id per symbol (each token is its own app instance).
    pub token_app_id_by_symbol: MapView<String, ApplicationId>,

    /// Bonding-curve pool configuration per symbol.
    pub pools: MapView<String, PoolConfig>,
    /// Pool wLin reserves per symbol (for pricing math).
    pub wlin_reserves: MapView<String, Amount>,
    /// Pool token reserves per symbol (for pricing math).
    pub token_reserves: MapView<String, Amount>,

    /// Stored user intents (limit orders).
    pub intents: MapView<IntentId, Intent>,
    /// Intent status (NotFilled / PartiallyFilled / Filled).
    pub intent_status: MapView<IntentId, IntentStatus>,
    /// Remaining unfilled amount per intent.
    pub intent_remaining: MapView<IntentId, Amount>,
    /// Escrowed amount per intent (reserved funds/tokens).
    pub intent_escrowed: MapView<IntentId, Amount>,
    /// Next intent id per symbol (monotonic counter).
    pub next_intent_id: MapView<String, u64>,

    /// Graduation flag per token symbol (LPs enabled after reserve threshold).
    pub lp_enabled: MapView<String, bool>,
}

/// Intent status for escrowed matching.
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
pub enum IntentStatus {
    NotFilled,
    PartiallyFilled,
    Filled,
}
