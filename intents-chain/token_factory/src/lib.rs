//! Token-factory app crate root.
//!
//! Defines the ABI and operations for creating token app instances from a
//! published fungible-token module.

pub mod state;

use linera_sdk::{graphql::GraphQLMutationRoot, linera_base_types::{ContractAbi, ServiceAbi}};
use serde::{Deserialize, Serialize};

use shared_types::SignedCreateTokenRequest;

/// ABI definition for the token-factory app.
pub struct TokenFactoryAbi;

/// Operations executed by the token-factory app.
#[derive(Debug, Deserialize, Serialize, GraphQLMutationRoot)]
pub enum Operation {
    /// Operator records the fungible-token ModuleId.
    SetModule { module_id: String },
    /// Operator sets the matching-engine app id.
    SetMatchingEngine { app_id: String },
    /// User requests creation of a new token app instance.
    CreateToken { request: SignedCreateTokenRequest },
}

impl ContractAbi for TokenFactoryAbi {
    type Operation = Operation;
    type Response = ();
}

impl ServiceAbi for TokenFactoryAbi {
    type Query = async_graphql::Request;
    type QueryResponse = async_graphql::Response;
}
