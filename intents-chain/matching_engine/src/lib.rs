//! Matching-engine app crate root.
//!
//! Defines the ABI and operations for the bonding-curve + escrow engine.

pub mod state;

use linera_sdk::{graphql::GraphQLMutationRoot, linera_base_types::{ContractAbi, ServiceAbi}};
use serde::{Deserialize, Serialize};

use shared_types::{IntentId, PoolConfig, SignedIntent, SignedTradeRequest};
use linera_sdk::linera_base_types::Amount;

/// ABI definition for the matching-engine app.
pub struct MatchingEngineAbi;

/// Operations executed by the matching-engine app.
#[derive(Debug, Deserialize, Serialize, GraphQLMutationRoot)]
pub enum Operation {
    /// Operator sets the wLin app id for pricing/trades.
    SetWlinApp { app_id: String },
    /// Operator sets fee destination for trade fees.
    SetFeeDestination { owner: linera_sdk::linera_base_types::AccountOwner },
    /// Create a pool for a token app (invoked by token factory).
    CreatePool { symbol: String, token_app_id: String, config: PoolConfig },
    /// Direct trades.
    Buy { trade: SignedTradeRequest },
    Sell { trade: SignedTradeRequest },
    /// Record user intent for off-chain matching.
    PlaceIntent { intent: SignedIntent },
    /// Operator settles an intent (partial fill supported).
    SettleIntent { intent_id: IntentId, fill_amount: Amount },
}

/// Fixed bonding-curve parameters from `docs/intro.md`.
pub fn fixed_pool_config() -> PoolConfig {
    PoolConfig {
        total_curve_supply: Amount::from_tokens(800_000_000),
        initial_price: "0.0001".to_string(),
        graduation_base_reserve: Amount::from_tokens(100_000),
        fee_bps: 100,
        v_x: Amount::from_tokens(80_000),
        v_y: Amount::ZERO,
    }
}

impl ContractAbi for MatchingEngineAbi {
    type Operation = Operation;
    type Response = ();
}

impl ServiceAbi for MatchingEngineAbi {
    type Query = async_graphql::Request;
    type QueryResponse = async_graphql::Response;
}
