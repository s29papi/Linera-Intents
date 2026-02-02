//! Signed fungible token app.
//!
//! Implements transfer/approve/transferFrom/allowance/claim using signed payloads.
//! Mint is restricted to an optional minter app id (used by the faucet for wLin).

pub mod state;

use async_graphql::scalar;
use linera_base::crypto::BcsSignable;
use linera_base::identifiers::ApplicationId;
use linera_sdk::{
    graphql::GraphQLMutationRoot,
    linera_base_types::{AccountOwner, Amount, ContractAbi, ServiceAbi},
};
use serde::{Deserialize, Serialize};

/// Parameters for a fungible token app instance.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Parameters {
    pub ticker_symbol: String,
    pub minter_app_id: Option<ApplicationId>,
    pub trusted_caller_app_id: Option<ApplicationId>,
}

impl Parameters {
    pub fn new(
        ticker_symbol: String,
        minter_app_id: Option<ApplicationId>,
        trusted_caller_app_id: Option<ApplicationId>,
    ) -> Self {
        Self { ticker_symbol, minter_app_id, trusted_caller_app_id }
    }
}

/// Initial state for a fungible token app instance.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct InitialState {
    pub balances: Vec<(AccountOwner, Amount)>,
}

#[derive(Default)]
pub struct InitialStateBuilder {
    balances: Vec<(AccountOwner, Amount)>,
}

impl InitialStateBuilder {
    pub fn with_account(mut self, owner: AccountOwner, amount: Amount) -> Self {
        self.balances.push((owner, amount));
        self
    }

    pub fn build(self) -> InitialState {
        InitialState { balances: self.balances }
    }
}

/// Account identifier for claim-like operations.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Account {
    pub chain_id: linera_sdk::linera_base_types::ChainId,
    pub owner: AccountOwner,
}

scalar!(Account);

/// Transfer payload (signed by owner).
#[derive(Clone, Debug, Deserialize, Serialize, async_graphql::InputObject)]
pub struct TransferRequest {
    pub owner: AccountOwner,
    pub amount: Amount,
    pub target_account: Account,
}
impl<'de> BcsSignable<'de> for TransferRequest {}

/// TransferFrom payload (signed by spender).
#[derive(Clone, Debug, Deserialize, Serialize, async_graphql::InputObject)]
pub struct TransferFromRequest {
    pub owner: AccountOwner,
    pub spender: AccountOwner,
    pub amount: Amount,
    pub target_account: Account,
}
impl<'de> BcsSignable<'de> for TransferFromRequest {}

/// Approve payload (signed by owner).
#[derive(Clone, Debug, Deserialize, Serialize, async_graphql::InputObject)]
pub struct ApproveRequest {
    pub owner: AccountOwner,
    pub spender: AccountOwner,
    pub allowance: Amount,
}
impl<'de> BcsSignable<'de> for ApproveRequest {}

/// Claim payload (signed by source owner).
#[derive(Clone, Debug, Deserialize, Serialize, async_graphql::InputObject)]
pub struct ClaimRequest {
    pub source_account: Account,
    pub amount: Amount,
    pub target_account: Account,
}
impl<'de> BcsSignable<'de> for ClaimRequest {}

/// Signed transfer request.
#[derive(Clone, Debug, Deserialize, Serialize, async_graphql::InputObject)]
pub struct SignedTransferRequest {
    pub payload: TransferRequest,
    pub signature_hex: String,
}

/// Signed transfer-from request.
#[derive(Clone, Debug, Deserialize, Serialize, async_graphql::InputObject)]
pub struct SignedTransferFromRequest {
    pub payload: TransferFromRequest,
    pub signature_hex: String,
}

/// Signed approve request.
#[derive(Clone, Debug, Deserialize, Serialize, async_graphql::InputObject)]
pub struct SignedApproveRequest {
    pub payload: ApproveRequest,
    pub signature_hex: String,
}

/// Signed claim request.
#[derive(Clone, Debug, Deserialize, Serialize, async_graphql::InputObject)]
pub struct SignedClaimRequest {
    pub payload: ClaimRequest,
    pub signature_hex: String,
}

/// Operations executed by the fungible token app.
#[derive(Debug, Deserialize, Serialize, GraphQLMutationRoot)]
pub enum Operation {
    Transfer { request: SignedTransferRequest },
    TransferFrom { request: SignedTransferFromRequest },
    Approve { request: SignedApproveRequest },
    Claim { request: SignedClaimRequest },
    /// Mint is restricted to minter_app_id (used for wLin faucet).
    Mint { owner: AccountOwner, amount: Amount },
}

/// ABI for the fungible token app.
pub struct FungibleTokenAbi;

impl ContractAbi for FungibleTokenAbi {
    type Operation = Operation;
    type Response = ();
}

impl ServiceAbi for FungibleTokenAbi {
    type Query = async_graphql::Request;
    type QueryResponse = async_graphql::Response;
}
