#![cfg_attr(target_arch = "wasm32", no_main)]

//! Contract logic for the signed fungible token app.

use linera_base::abi::WithContractAbi;
use linera_base::crypto::AccountSignature;
use linera_base::identifiers::AccountOwner;
use linera_sdk::linera_base_types::Amount;
use linera_sdk::{contract::ContractRuntime, Contract, views::{RootView, View}};

use fungible_token::{
    FungibleTokenAbi, InitialState, Operation, Parameters, SignedApproveRequest,
    SignedClaimRequest, SignedTransferFromRequest, SignedTransferRequest,
};
use fungible_token::state::FungibleState;

pub struct FungibleContract {
    state: FungibleState,
    runtime: ContractRuntime<Self>,
}

linera_sdk::contract!(FungibleContract);

impl WithContractAbi for FungibleContract {
    type Abi = FungibleTokenAbi;
}

impl Contract for FungibleContract {
    type Message = ();
    type Parameters = Parameters;
    type InstantiationArgument = InitialState;
    type EventValue = ();

    async fn load(runtime: ContractRuntime<Self>) -> Self {
        let state = FungibleState::load(runtime.root_view_storage_context())
            .await
            .expect("Failed to load state");
        FungibleContract { state, runtime }
    }

    async fn instantiate(&mut self, state: Self::InstantiationArgument) {
        for (owner, amount) in state.balances {
            let current = self
                .state
                .balances
                .get(&owner)
                .await
                .expect("Failed to read balance")
                .unwrap_or_default();
            self.state
                .balances
                .insert(&owner, current.saturating_add(amount))
                .expect("Failed to update balance");
        }
    }

    async fn execute_operation(&mut self, operation: Self::Operation) -> Self::Response {
        match operation {
            Operation::Transfer { request } => self.transfer(request).await,
            Operation::TransferFrom { request } => self.transfer_from(request).await,
            Operation::Approve { request } => self.approve(request).await,
            Operation::Claim { request } => self.claim(request).await,
            Operation::Mint { owner, amount } => self.mint(owner, amount).await,
        }
    }

    async fn execute_message(&mut self, _message: Self::Message) {}

    async fn store(mut self) {
        self.state.save().await.expect("Failed to save state");
    }
}

impl FungibleContract {
    async fn transfer(&mut self, request: SignedTransferRequest) {
        let owner = self.resolve_signer(&request.payload, request.payload.owner, &request.signature_hex);
        if request.payload.owner != owner {
            panic!("Signature owner mismatch");
        }
        self.debit_credit(
            request.payload.owner,
            request.payload.target_account.owner,
            request.payload.amount,
        )
        .await;
    }

    async fn transfer_from(&mut self, request: SignedTransferFromRequest) {
        // Require payload owner signature.
        let owner =
            self.resolve_signer(&request.payload, request.payload.owner, &request.signature_hex);
        if request.payload.owner != owner {
            panic!("Signature owner mismatch");
        }
        let key = (request.payload.owner, request.payload.spender);
        let current = self
            .state
            .allowances
            .get(&key)
            .await
            .expect("Failed to read allowance")
            .unwrap_or_default();
        if current < request.payload.amount {
            panic!("Allowance exceeded");
        }
        self.state
            .allowances
            .insert(&key, current.saturating_sub(request.payload.amount))
            .expect("Failed to update allowance");
        self.debit_credit(
            request.payload.owner,
            request.payload.target_account.owner,
            request.payload.amount,
        )
        .await;
    }

    async fn approve(&mut self, request: SignedApproveRequest) {
        let owner = self.resolve_signer(&request.payload, request.payload.owner, &request.signature_hex);
        if request.payload.owner != owner {
            panic!("Signature owner mismatch");
        }
        let key = (request.payload.owner, request.payload.spender);
        self.state
            .allowances
            .insert(&key, request.payload.allowance)
            .expect("Failed to update allowance");
    }

    async fn claim(&mut self, request: SignedClaimRequest) {
        let owner = self.resolve_signer(&request.payload, request.payload.source_account.owner, &request.signature_hex);
        if request.payload.source_account.owner != owner {
            panic!("Signature owner mismatch");
        }
        if request.payload.source_account.chain_id != self.runtime.chain_id() ||
           request.payload.target_account.chain_id != self.runtime.chain_id() {
            panic!("Claim is only supported on the same chain in this design");
        }
        self.debit_credit(
            request.payload.source_account.owner,
            request.payload.target_account.owner,
            request.payload.amount,
        )
        .await;
    }

    async fn mint(&mut self, owner: AccountOwner, amount: Amount) {
        // NOTE: Mint is now permissionless at the token contract level.
        // The faucet still enforces the per-owner cap for faucetMint, but
        // direct Mint calls will no longer be blocked here.
        let current = self
            .state
            .balances
            .get(&owner)
            .await
            .expect("Failed to read balance")
            .unwrap_or_default();
        self.state
            .balances
            .insert(&owner, current.saturating_add(amount))
            .expect("Failed to update balance");
    }

    async fn debit_credit(&mut self, from: AccountOwner, to: AccountOwner, amount: Amount) {
        let from_balance = self
            .state
            .balances
            .get(&from)
            .await
            .expect("Failed to read balance")
            .unwrap_or_default();
        if from_balance < amount {
            panic!("Insufficient balance");
        }
        self.state
            .balances
            .insert(&from, from_balance.saturating_sub(amount))
            .expect("Failed to update balance");
        let to_balance = self
            .state
            .balances
            .get(&to)
            .await
            .expect("Failed to read balance")
            .unwrap_or_default();
        self.state
            .balances
            .insert(&to, to_balance.saturating_add(amount))
            .expect("Failed to update balance");
    }

    fn resolve_signer<T: std::fmt::Debug>(
        &mut self,  
        payload: &T,
        _expected: AccountOwner,
        signature_hex: &str,
    ) -> AccountOwner
    where
        for<'de> T: linera_base::crypto::BcsSignable<'de>,
    {
        if signature_hex.is_empty() {
            // Allow empty signature if caller is trusted matching_engine, or signer matches expected.
            if let Some(caller) = self.runtime.authenticated_caller_id() {
                let params = self.runtime.application_parameters();
                if params.trusted_caller_app_id == Some(caller) {
                    return _expected;
                }
            }
            if let Some(signer) = self.runtime.authenticated_signer() {
                if _expected == signer {
                    return signer;
                }
            }
            panic!("Missing signature");
        }
        self.verify_signature(payload, signature_hex)
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
