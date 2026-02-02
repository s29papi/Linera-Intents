//! On-chain state for the token-factory app.

use linera_base::identifiers::{ApplicationId, ModuleId};
use linera_sdk::linera_base_types::AccountOwner;
use linera_sdk::views::{linera_views, MapView, RegisterView, RootView, ViewStorageContext};

use shared_types::TokenMetadata;

/// Persistent storage for token-factory app.
#[derive(RootView)]
#[view(context = ViewStorageContext)]
pub struct TokenFactoryState {
    /// Published fungible-token module id (bytecode).
    pub module_id: RegisterView<Option<ModuleId>>,
    /// Matching-engine app id (same chain).
    pub matching_engine_app_id: RegisterView<Option<ApplicationId>>,

    /// Registry: token symbol -> app id.
    pub token_app_id_by_symbol: MapView<String, ApplicationId>,
    /// Registry: token app id -> metadata.
    pub token_metadata_by_app: MapView<ApplicationId, TokenMetadata>,
    /// Registry: token symbol -> creator.
    pub creator_by_symbol: MapView<String, AccountOwner>,
}
