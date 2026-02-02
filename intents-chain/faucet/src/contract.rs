#![cfg_attr(target_arch = "wasm32", no_main)]

//! Contract logic for the faucet app.

use linera_base::abi::WithContractAbi;
use linera_base::identifiers::ApplicationId;
use linera_sdk::linera_base_types::Amount;
use linera_sdk::{contract::ContractRuntime, Contract, views::{RootView, View}};

use faucet::{FaucetAbi, Operation};
use faucet::state::FaucetState;
use fungible_token::{FungibleTokenAbi, Operation as FungibleOperation};

pub struct FaucetContract {
    state: FaucetState,
    runtime: ContractRuntime<Self>,
}

linera_sdk::contract!(FaucetContract);

impl WithContractAbi for FaucetContract {
    type Abi = FaucetAbi;
}

impl Contract for FaucetContract {
    type Message = ();
    type Parameters = ();
    type InstantiationArgument = ();
    type EventValue = ();

    async fn load(runtime: ContractRuntime<Self>) -> Self {
        let state = FaucetState::load(runtime.root_view_storage_context())
            .await
            .expect("Failed to load state");
        FaucetContract { state, runtime }
    }

    async fn instantiate(&mut self, _state: Self::InstantiationArgument) {}

    async fn execute_operation(&mut self, operation: Self::Operation) -> Self::Response {
        match operation {
            Operation::SetWlinApp { app_id } => self.set_wlin_app(app_id),
            Operation::SetFaucetCap { amount } => self.state.faucet_cap.set(amount),
            Operation::FaucetMint { amount, owner } => self.faucet_mint(amount, owner).await,
        }
    }

    async fn execute_message(&mut self, _message: Self::Message) {}

    async fn store(mut self) {
        self.state.save().await.expect("Failed to save state");
    }
}

impl FaucetContract {
    fn set_wlin_app(&mut self, app_id: String) {
        let parsed = app_id.parse::<ApplicationId>().expect("Invalid app id");
        self.state.wlin_app_id.set(Some(parsed));
    }

    async fn faucet_mint(&mut self, amount: Amount, owner: Option<String>) {
        let owner = match owner {
            Some(owner) => owner.parse().expect("Invalid owner"),
            None => self.runtime.authenticated_signer().expect("Missing signer"),
        };
        let minted = self
            .state
            .minted_by_owner
            .get(&owner)
            .await
            .expect("Failed to read minted")
            .unwrap_or_default();
        let cap = *self.state.faucet_cap.get();
        if minted.saturating_add(amount) > cap {
            panic!("Faucet cap exceeded");
        }

        let wlin = self
            .state
            .wlin_app_id
            .get()
            .clone()
            .expect("wLin app id not set")
            .with_abi::<FungibleTokenAbi>();

        let op = FungibleOperation::Mint { owner, amount };
        self.runtime.call_application(true, wlin, &op);

        self.state
            .minted_by_owner
            .insert(&owner, minted.saturating_add(amount))
            .expect("Failed to update minted");
    }
}
