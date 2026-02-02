//! Faucet app crate root.
//!
//! Provides capped minting of wLin via transfers from a pre-funded faucet account.

pub mod state;

use linera_sdk::{graphql::GraphQLMutationRoot, linera_base_types::{ContractAbi, ServiceAbi}};
use serde::{Deserialize, Serialize};

/// ABI definition for the faucet app.
pub struct FaucetAbi;

/// Operations executed by the faucet app.
#[derive(Debug, Deserialize, Serialize, GraphQLMutationRoot)]
pub enum Operation {
    /// Operator sets the wLin app id.
    SetWlinApp { app_id: String },
    /// Operator sets the per-user faucet cap.
    SetFaucetCap { amount: linera_sdk::linera_base_types::Amount },
    /// User requests faucet mint of wLin. Optional owner overrides the signer.
    FaucetMint {
        amount: linera_sdk::linera_base_types::Amount,
        owner: Option<String>,
    },
}

impl ContractAbi for FaucetAbi {
    type Operation = Operation;
    type Response = ();
}

impl ServiceAbi for FaucetAbi {
    type Query = async_graphql::Request;
    type QueryResponse = async_graphql::Response;
}
