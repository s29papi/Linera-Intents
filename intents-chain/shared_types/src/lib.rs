//! Shared data types for the single-chain intents app.
//!
//! These types define the public API payloads for GraphQL operations and the
//! internal data structures stored in `IntentsState`. They are referenced by:
//! - `intents-chain/src/lib.rs` (ABI + operations)
//! - `intents-chain/src/contract.rs` (execution + verification)
//! - `intents-chain/src/service.rs` (queries)
//! - `intents-chain/src/state.rs` (persistent storage)

use async_graphql::{Enum, InputObject, SimpleObject, scalar};
use linera_base::crypto::BcsSignable;
use linera_sdk::linera_base_types::{AccountOwner, Amount};
use serde::{Deserialize, Serialize};

/// Token metadata stored on-chain.
///
/// Used by the token factory registry and exposed by queries.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, InputObject, SimpleObject)]
#[graphql(input_name = "TokenMetadataInput")]
pub struct TokenMetadata {
    /// Display name.
    pub name: String,
    /// Token symbol (unique).
    pub symbol: String,
    /// Token decimals (implicit; no normalization enforced in code).
    pub decimals: u8,
}

/// Token creation request (user -> token factory).
///
/// Used by `Operation::CreateToken` after signature verification.
#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct CreateTokenRequest {
    /// Creator / owner of the token.
    pub owner: AccountOwner,
    /// Metadata (symbol, name, decimals).
    pub metadata: TokenMetadata,
    /// Initial supply to mint to the creator.
    pub initial_supply: Amount,
}

impl<'de> BcsSignable<'de> for CreateTokenRequest {}

/// Bonding curve configuration (pump-style).
///
/// Stored per token and used for pricing/trade execution.
#[derive(Clone, Debug, Deserialize, Serialize, InputObject, SimpleObject, PartialEq, Eq)]
#[graphql(input_name = "PoolConfigInput")]
pub struct PoolConfig {
    /// Total curve supply in the pool (token reserve).
    pub total_curve_supply: Amount,
    /// Initial price string (human-friendly).
    pub initial_price: String,
    /// Graduation reserve threshold in wLin.
    pub graduation_base_reserve: Amount,
    /// Fee in basis points charged on trades.
    pub fee_bps: u16,
    /// Virtual reserve X (wLin) for curve shape.
    pub v_x: Amount,
    /// Virtual reserve Y (token) for curve shape.
    pub v_y: Amount,
}

// (CreatePoolRequest removed; pool creation is an app-level operation in matching_engine.)

/// Trade side for buys/sells.
#[derive(Clone, Debug, Deserialize, Serialize, Enum, Copy, Eq, PartialEq)]
pub enum Side {
    /// Buy tokens with wLin.
    Buy,
    /// Sell tokens for wLin.
    Sell,
}

/// Trade request (user -> matching engine).
///
/// Used by `Operation::Buy` and `Operation::Sell` after signature verification.
#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct TradeRequest {
    /// Trade initiator / owner.
    pub owner: AccountOwner,
    /// Token symbol being traded.
    pub symbol: String,
    /// Buy or sell.
    pub side: Side,
    /// Amount in (wLin for Buy, token for Sell).
    pub amount: Amount,
    /// Minimum output required (slippage protection).
    pub min_out: Amount,
}

impl<'de> BcsSignable<'de> for TradeRequest {}

/// Signed trade request with user signature.
///
/// Signature is verified in contract before applying the trade.
#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct SignedTradeRequest {
    /// Trade payload.
    pub payload: TradeRequest,
    /// Hex-encoded AccountSignature bytes.
    pub signature_hex: String,
}

/// Intent request (limit order) recorded for off-chain matching.
///
/// Stored in `IntentsState.intents` and settled by the operator.
#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct Intent {
    /// Intent owner / signer.
    pub owner: AccountOwner,
    /// Token symbol.
    pub symbol: String,
    /// Buy or sell.
    pub side: Side,
    /// Amount to trade when settled.
    pub amount: Amount,
    /// Limit price as string (parsed into Amount).
    pub limit_price: String,
}

impl<'de> BcsSignable<'de> for Intent {}

/// Signed intent request with user signature.
///
/// Signature is verified before escrow reservation.
#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct SignedIntent {
    /// Intent payload.
    pub payload: Intent,
    /// Hex-encoded AccountSignature bytes.
    pub signature_hex: String,
}

/// Unique identifier for an intent.
///
/// Generated per symbol by `next_intent_id`.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct IntentId(pub u64);

/// Signed token creation request with user signature.
///
/// Verified before minting initial supply and creating a pool.
#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct SignedCreateTokenRequest {
    /// Token creation payload.
    pub payload: CreateTokenRequest,
    /// Hex-encoded AccountSignature bytes.
    pub signature_hex: String,
}

scalar!(IntentId);
