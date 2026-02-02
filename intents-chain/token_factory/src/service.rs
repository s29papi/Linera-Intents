#![cfg_attr(target_arch = "wasm32", no_main)]

//! GraphQL service for the token-factory app.

use std::sync::Arc;

use async_graphql::{EmptySubscription, Object, Request, Response, Schema};
use linera_sdk::{
    graphql::GraphQLMutationRoot as _,
    linera_base_types::WithServiceAbi,
    views::View,
    Service, ServiceRuntime,
};

use token_factory::{Operation, TokenFactoryAbi};
use token_factory::state::TokenFactoryState;

#[derive(Clone)]
pub struct TokenFactoryService {
    state: Arc<TokenFactoryState>,
    runtime: Arc<ServiceRuntime<Self>>,
}

linera_sdk::service!(TokenFactoryService);

impl WithServiceAbi for TokenFactoryService {
    type Abi = TokenFactoryAbi;
}

impl Service for TokenFactoryService {
    type Parameters = ();

    async fn new(runtime: ServiceRuntime<Self>) -> Self {
        let state = TokenFactoryState::load(runtime.root_view_storage_context())
            .await
            .expect("Failed to load TokenFactoryState");
        TokenFactoryService {
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
impl TokenFactoryService {
    async fn module_id(&self) -> Option<String> {
        self.state.module_id.get().as_ref().map(|id| id.to_string())
    }

    async fn matching_engine_app_id(&self) -> Option<String> {
        self.state
            .matching_engine_app_id
            .get()
            .as_ref()
            .map(|id| id.to_string())
    }

    async fn token_app_id(&self, symbol: String) -> Option<String> {
        self.state
            .token_app_id_by_symbol
            .get(&symbol)
            .await
            .expect("Failed to read token app id")
            .map(|id| id.to_string())
    }

    async fn token_metadata(&self, symbol: String) -> Option<shared_types::TokenMetadata> {
        let app_id = self
            .state
            .token_app_id_by_symbol
            .get(&symbol)
            .await
            .expect("Failed to read token app id")?;
        self.state
            .token_metadata_by_app
            .get(&app_id)
            .await
            .expect("Failed to read token metadata")
    }
}
