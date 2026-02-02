#![cfg_attr(target_arch = "wasm32", no_main)]

//! Contract logic for the token-factory app.

use linera_base::crypto::AccountSignature;
use linera_base::abi::WithContractAbi;
use linera_base::identifiers::{AccountOwner, ApplicationId, ModuleId};
use fungible_token::{FungibleTokenAbi, InitialStateBuilder, Parameters};
use linera_sdk::{contract::ContractRuntime, Contract, views::{RootView, View}};
use serde_json::Value;

use matching_engine::{fixed_pool_config, Operation as MatchingEngineOperation};
use shared_types::SignedCreateTokenRequest;

use token_factory::{Operation, TokenFactoryAbi};
use token_factory::state::TokenFactoryState;

pub struct TokenFactoryContract {
    state: TokenFactoryState,
    runtime: ContractRuntime<Self>,
}

linera_sdk::contract!(TokenFactoryContract);

impl WithContractAbi for TokenFactoryContract {
    type Abi = TokenFactoryAbi;
}

impl Contract for TokenFactoryContract {
    type Message = ();
    type Parameters = ();
    type InstantiationArgument = ();
    type EventValue = ();

    async fn load(runtime: ContractRuntime<Self>) -> Self {
        let state = TokenFactoryState::load(runtime.root_view_storage_context())
            .await
            .expect("Failed to load state");
        TokenFactoryContract { state, runtime }
    }

    async fn instantiate(&mut self, _state: Self::InstantiationArgument) {}

    async fn execute_operation(&mut self, operation: Self::Operation) -> Self::Response {
        match operation {
            Operation::SetModule { module_id } => self.set_module(module_id),
            Operation::SetMatchingEngine { app_id } => self.set_matching_engine(app_id),
            Operation::CreateToken { request } => self.create_token(request).await,
        }
    }

    async fn execute_message(&mut self, _message: Self::Message) {}

    async fn store(mut self) {
        self.state.save().await.expect("Failed to save state");
    }
}

impl TokenFactoryContract {
    fn set_module(&mut self, module_id: String) {
        let parsed = module_id.parse::<ModuleId>().expect("Invalid module id");
        self.state.module_id.set(Some(parsed));
    }

    fn set_matching_engine(&mut self, app_id: String) {
        let parsed = app_id.parse::<ApplicationId>().expect("Invalid app id");
        self.state.matching_engine_app_id.set(Some(parsed));
    }

    async fn create_token(&mut self, request: SignedCreateTokenRequest) {
        let owner = self.verify_signature(&request.payload, &request.signature_hex);
        if request.payload.owner != owner {
            panic!("Signature owner mismatch");
        }

        let symbol = request.payload.metadata.symbol.clone();
        if self
            .state
            .token_app_id_by_symbol
            .get(&symbol)
            .await
            .expect("Failed to read token registry")
            .is_some()
        {
            panic!("Token symbol already exists");
        }

        let config = fixed_pool_config();
        if request.payload.initial_supply != config.total_curve_supply {
            panic!("Initial supply must match fixed curve supply");
        }

        let module_id = self
            .state
            .module_id
            .get()
            .clone()
            .expect("ModuleId not set");

        let matching_engine_app_id = self
            .state
            .matching_engine_app_id
            .get()
            .clone()
            .expect("Matching-engine app id not set");

        // Initialize token app with fixed curve supply owned by matching-engine app.
        let mut initial_state = InitialStateBuilder::default();
        let pool_owner: AccountOwner = matching_engine_app_id.into();
        initial_state = initial_state.with_account(pool_owner, config.total_curve_supply);

        let params = Parameters::new(
            request.payload.metadata.symbol.clone(),
            None,
            Some(matching_engine_app_id),
        );
        let application_id = self
            .runtime
            .create_application::<FungibleTokenAbi, Parameters, fungible_token::InitialState>(
                module_id.with_abi(),
                &params,
                &initial_state.build(),
                vec![],
            );
        let application_id = application_id.forget_abi();

        // Record registry entries.
        self.state
            .token_app_id_by_symbol
            .insert(&symbol, application_id)
            .expect("Failed to insert token app id");
        self.state
            .token_metadata_by_app
            .insert(&application_id, request.payload.metadata.clone())
            .expect("Failed to insert token metadata");
        self.state
            .creator_by_symbol
            .insert(&symbol, owner)
            .expect("Failed to insert creator");

        // Instruct matching engine to create the pool on the same chain.
        let token_app_id_str = match serde_json::to_value(&application_id)
            .expect("Failed to serialize application id")
        {
            Value::String(s) => s,
            _ => panic!("Expected application id as string"),
        };
        let op = MatchingEngineOperation::CreatePool {
            symbol,
            token_app_id: token_app_id_str,
            config,
        };
        self.runtime
            .call_application(true, matching_engine_app_id.with_abi::<matching_engine::MatchingEngineAbi>(), &op);
    }

    fn verify_signature<T: std::fmt::Debug>(&self, payload: &T, signature_hex: &str) -> AccountOwner
    where
        for<'de> T: linera_base::crypto::BcsSignable<'de>,
    {
        let bytes = hex::decode(signature_hex).expect("Invalid signature hex");
        let signature = AccountSignature::try_from(bytes.as_slice())
            .expect("Invalid account signature");
        signature.verify(payload).expect("Signature verification failed");
        match signature {
            AccountSignature::Ed25519 { public_key, .. } => AccountOwner::from(public_key),
            AccountSignature::Secp256k1 { public_key, .. } => AccountOwner::from(public_key),
            AccountSignature::EvmSecp256k1 { address, .. } => AccountOwner::Address20(address),
        }
    }
}
