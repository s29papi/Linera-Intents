#![cfg_attr(target_arch = "wasm32", no_main)]

//! GraphQL service for the faucet app.

use std::sync::Arc;

use async_graphql::{EmptySubscription, Object, Request, Response, Schema};
use linera_sdk::{
    graphql::GraphQLMutationRoot as _,
    linera_base_types::WithServiceAbi,
    views::View,
    Service, ServiceRuntime,
};

use faucet::{FaucetAbi, Operation};
use faucet::state::FaucetState;

#[derive(Clone)]
pub struct FaucetService {
    state: Arc<FaucetState>,
    runtime: Arc<ServiceRuntime<Self>>,
}

linera_sdk::service!(FaucetService);

impl WithServiceAbi for FaucetService {
    type Abi = FaucetAbi;
}

impl Service for FaucetService {
    type Parameters = ();

    async fn new(runtime: ServiceRuntime<Self>) -> Self {
        let state = FaucetState::load(runtime.root_view_storage_context())
            .await
            .expect("Failed to load FaucetState");
        FaucetService {
            state: Arc::new(state),
            runtime: Arc::new(runtime),
        }
    }

    async fn handle_query(&self, request: Request) -> Response {
        let schema = Schema::build(
            self.clone(),
            Operation::mutation_root(self.runtime.clone()),
            EmptySubscription,
        )
        .finish();
        schema.execute(request).await
    }
}

#[Object]
impl FaucetService {
    async fn wlin_app_id(&self) -> Option<String> {
        self.state.wlin_app_id.get().as_ref().map(|id| id.to_string())
    }

    async fn faucet_cap(&self) -> linera_sdk::linera_base_types::Amount {
        *self.state.faucet_cap.get()
    }

    async fn minted_amount(&self, owner: linera_sdk::linera_base_types::AccountOwner) -> Option<linera_sdk::linera_base_types::Amount> {
        self.state
            .minted_by_owner
            .get(&owner)
            .await
            .expect("Failed to read minted")
    }
}
