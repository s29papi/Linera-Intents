#![cfg_attr(target_arch = "wasm32", no_main)]

//! GraphQL service for the matching-engine app.

use std::sync::Arc;

use async_graphql::{EmptySubscription, Object, Request, Response, Schema};
use linera_sdk::{
    graphql::GraphQLMutationRoot as _,
    linera_base_types::WithServiceAbi,
    views::View,
    Service, ServiceRuntime,
};

use matching_engine::{MatchingEngineAbi, Operation};
use matching_engine::state::MatchingEngineState;

#[derive(Clone)]
pub struct MatchingEngineService {
    state: Arc<MatchingEngineState>,
    runtime: Arc<ServiceRuntime<Self>>,
}

linera_sdk::service!(MatchingEngineService);

impl WithServiceAbi for MatchingEngineService {
    type Abi = MatchingEngineAbi;
}

impl Service for MatchingEngineService {
    type Parameters = ();

    async fn new(runtime: ServiceRuntime<Self>) -> Self {
        let state = MatchingEngineState::load(runtime.root_view_storage_context())
            .await
            .expect("Failed to load MatchingEngineState");
        MatchingEngineService {
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
impl MatchingEngineService {
    async fn wlin_app_id(&self) -> Option<String> {
        self.state.wlin_app_id.get().as_ref().map(|id| id.to_string())
    }

    async fn token_app_id(&self, symbol: String) -> Option<String> {
        self.state
            .token_app_id_by_symbol
            .get(&symbol)
            .await
            .expect("Failed to read token app id")
            .map(|id| id.to_string())
    }

    async fn pool_config(&self, symbol: String) -> Option<shared_types::PoolConfig> {
        self.state
            .pools
            .get(&symbol)
            .await
            .expect("Failed to read pool config")
    }

    async fn wlin_reserve(&self, symbol: String) -> Option<linera_sdk::linera_base_types::Amount> {
        self.state
            .wlin_reserves
            .get(&symbol)
            .await
            .expect("Failed to read wLin reserve")
    }

    async fn token_reserve(&self, symbol: String) -> Option<linera_sdk::linera_base_types::Amount> {
        self.state
            .token_reserves
            .get(&symbol)
            .await
            .expect("Failed to read token reserve")
    }

    async fn lp_enabled(&self, symbol: String) -> Option<bool> {
        self.state
            .lp_enabled
            .get(&symbol)
            .await
            .expect("Failed to read LP flag")
    }
}
