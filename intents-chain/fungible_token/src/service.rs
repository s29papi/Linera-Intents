#![cfg_attr(target_arch = "wasm32", no_main)]

//! GraphQL service for the signed fungible token app.

use std::sync::Arc;

use async_graphql::{EmptySubscription, Object, Request, Response, Schema};
use linera_sdk::{
    graphql::GraphQLMutationRoot as _,
    linera_base_types::WithServiceAbi,
    views::View,
    Service, ServiceRuntime,
};

use fungible_token::{FungibleTokenAbi, Operation};
use fungible_token::state::FungibleState;

#[derive(Clone)]
pub struct FungibleService {
    state: Arc<FungibleState>,
    runtime: Arc<ServiceRuntime<Self>>,
}

linera_sdk::service!(FungibleService);

impl WithServiceAbi for FungibleService {
    type Abi = FungibleTokenAbi;
}

impl Service for FungibleService {
    type Parameters = fungible_token::Parameters;

    async fn new(runtime: ServiceRuntime<Self>) -> Self {
        let state = FungibleState::load(runtime.root_view_storage_context())
            .await
            .expect("Failed to load FungibleState");
        FungibleService {
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
impl FungibleService {
    async fn ticker_symbol(&self) -> String {
        self.runtime.application_parameters().ticker_symbol.clone()
    }

    async fn balance(&self, owner: linera_sdk::linera_base_types::AccountOwner) -> Option<linera_sdk::linera_base_types::Amount> {
        self.state
            .balances
            .get(&owner)
            .await
            .expect("Failed to read balance")
    }

    async fn allowance(
        &self,
        owner: linera_sdk::linera_base_types::AccountOwner,
        spender: linera_sdk::linera_base_types::AccountOwner,
    ) -> Option<linera_sdk::linera_base_types::Amount> {
        self.state
            .allowances
            .get(&(owner, spender))
            .await
            .expect("Failed to read allowance")
    }
}
