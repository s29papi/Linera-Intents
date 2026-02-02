#![cfg_attr(target_arch = "wasm32", no_main)]

//! Contract logic for the matching-engine app.

use linera_base::crypto::AccountSignature;
use linera_base::abi::WithContractAbi;
use linera_base::identifiers::{ApplicationId, AccountOwner};
use linera_sdk::linera_base_types::Amount;
use linera_sdk::{contract::ContractRuntime, Contract, views::{RootView, View}};
use serde_json::Value;

use matching_engine::{MatchingEngineAbi, Operation};
use matching_engine::state::{IntentStatus, MatchingEngineState};
use shared_types::{IntentId, SignedIntent, SignedTradeRequest, TradeRequest, Side};
use fungible_token::{
    Account, FungibleTokenAbi, Operation as FungibleOperation, SignedTransferFromRequest,
    SignedTransferRequest,
};

pub struct MatchingEngineContract {
    state: MatchingEngineState,
    runtime: ContractRuntime<Self>,
}

linera_sdk::contract!(MatchingEngineContract);

impl WithContractAbi for MatchingEngineContract {
    type Abi = MatchingEngineAbi;
}

impl Contract for MatchingEngineContract {
    type Message = ();
    type Parameters = ();
    type InstantiationArgument = ();
    type EventValue = ();

    async fn load(runtime: ContractRuntime<Self>) -> Self {
        let state = MatchingEngineState::load(runtime.root_view_storage_context())
            .await
            .expect("Failed to load state");
        MatchingEngineContract { state, runtime }
    }

    async fn instantiate(&mut self, _state: Self::InstantiationArgument) {}

    async fn execute_operation(&mut self, operation: Self::Operation) -> Self::Response {
        match operation {
            Operation::SetWlinApp { app_id } => self.set_wlin_app(app_id),
            Operation::SetFeeDestination { owner } => self.state.fee_destination.set(Some(owner)),
            Operation::CreatePool { symbol, token_app_id, config } => {
                self.create_pool(symbol, token_app_id, config).await
            }
            Operation::Buy { trade } => self.execute_buy(trade).await,
            Operation::Sell { trade } => self.execute_sell(trade).await,
            Operation::PlaceIntent { intent } => self.place_intent(intent).await,
            Operation::SettleIntent { intent_id, fill_amount } => {
                self.settle_intent(intent_id, fill_amount).await
            }
        }
    }

    async fn execute_message(&mut self, _message: Self::Message) {}

    async fn store(mut self) {
        self.state.save().await.expect("Failed to save state");
    }
}

impl MatchingEngineContract {
    fn set_wlin_app(&mut self, app_id: String) {
        let parsed = app_id.parse::<ApplicationId>().expect("Invalid application id");
        self.state.wlin_app_id.set(Some(parsed));
    }

    async fn create_pool(&mut self, symbol: String, token_app_id: String, config: shared_types::PoolConfig) {
        if self.state.pools.get(&symbol).await.expect("Failed to read pools").is_some() {
            panic!("Pool already exists");
        }
        let token_app_id: ApplicationId = serde_json::from_value(Value::String(token_app_id))
            .expect("Invalid token app id");
        self.state
            .token_app_id_by_symbol
            .insert(&symbol, token_app_id)
            .expect("Failed to insert token app id");
        self.state
            .pools
            .insert(&symbol, config.clone())
            .expect("Failed to insert pool config");
        self.state
            .wlin_reserves
            .insert(&symbol, Amount::ZERO)
            .expect("Failed to insert wLin reserve");
        self.state
            .token_reserves
            .insert(&symbol, config.total_curve_supply)
            .expect("Failed to insert token reserve");
        self.state
            .lp_enabled
            .insert(&symbol, false)
            .expect("Failed to set LP flag");
    }

    async fn execute_buy(&mut self, trade: SignedTradeRequest) {
        let owner = self.verify_signature(&trade.payload, &trade.signature_hex);
        if trade.payload.owner != owner {
            panic!("Signature owner mismatch");
        }
        self.execute_trade_with_transfer(trade.payload, trade.signature_hex, true).await;
    }

    async fn execute_sell(&mut self, trade: SignedTradeRequest) {
        let owner = self.verify_signature(&trade.payload, &trade.signature_hex);
        if trade.payload.owner != owner {
            panic!("Signature owner mismatch");
        }
        self.execute_trade_with_transfer(trade.payload, trade.signature_hex, false).await;
    }

    async fn place_intent(&mut self, intent: SignedIntent) {
        let owner = self.verify_signature(&intent.payload, &intent.signature_hex);
        if intent.payload.owner != owner {
            panic!("Signature owner mismatch");
        }
        let symbol = intent.payload.symbol.clone();
        let amount = intent.payload.amount;
        if amount == Amount::ZERO {
            panic!("Intent amount must be > 0");
        }

        // Escrow: move assets into the matching-engine app account.
        self.transfer_in_intent(&intent.payload, &intent.signature_hex, amount).await;

        let next = self
            .state
            .next_intent_id
            .get(&symbol)
            .await
            .expect("Failed to read next_intent_id")
            .unwrap_or_default();
        let intent_id = IntentId(next + 1);
        self.state
            .intents
            .insert(&intent_id, intent.payload)
            .expect("Failed to insert intent");
        self.state
            .intent_status
            .insert(&intent_id, IntentStatus::NotFilled)
            .expect("Failed to insert intent status");
        self.state
            .intent_remaining
            .insert(&intent_id, amount)
            .expect("Failed to insert intent remaining");
        self.state
            .intent_escrowed
            .insert(&intent_id, amount)
            .expect("Failed to insert intent escrowed");
        self.state
            .next_intent_id
            .insert(&symbol, next + 1)
            .expect("Failed to update next_intent_id");
    }

    async fn settle_intent(&mut self, intent_id: IntentId, fill_amount: Amount) {
        let status = self
            .state
            .intent_status
            .get(&intent_id)
            .await
            .expect("Failed to read intent status")
            .expect("Intent not found");
        if status == IntentStatus::Filled {
            return;
        }

        let intent = self
            .state
            .intents
            .get(&intent_id)
            .await
            .expect("Failed to read intent")
            .expect("Intent not found");
        let remaining = self
            .state
            .intent_remaining
            .get(&intent_id)
            .await
            .expect("Failed to read intent remaining")
            .unwrap_or_default();
        if remaining == Amount::ZERO {
            self.state
                .intent_status
                .insert(&intent_id, IntentStatus::Filled)
                .expect("Failed to update intent status");
            return;
        }
        let fill = if fill_amount == Amount::ZERO {
            remaining
        } else {
            std::cmp::min(fill_amount, remaining)
        };

        let price = self.current_price(&intent.symbol).await;
        let limit = intent
            .limit_price
            .parse::<Amount>()
            .expect("Invalid limit price format");
        let is_buy = intent.side == Side::Buy;
        if (is_buy && price > limit) || (!is_buy && price < limit) {
            panic!("Limit price not satisfied");
        }

        let trade = TradeRequest {
            symbol: intent.symbol.clone(),
            side: intent.side,
            amount: fill,
            min_out: Amount::ZERO,
            owner: intent.owner,
        };
        self.execute_trade_from_escrow(trade, is_buy).await;

        let new_remaining = remaining.saturating_sub(fill);
        self.state
            .intent_remaining
            .insert(&intent_id, new_remaining)
            .expect("Failed to update intent remaining");
        self.state
            .intent_escrowed
            .insert(&intent_id, new_remaining)
            .expect("Failed to update intent escrowed");
        let new_status = if new_remaining == Amount::ZERO {
            IntentStatus::Filled
        } else {
            IntentStatus::PartiallyFilled
        };
        self.state
            .intent_status
            .insert(&intent_id, new_status)
            .expect("Failed to update intent status");
    }

    async fn execute_trade_with_transfer(&mut self, trade: TradeRequest, signature_hex: String, is_buy: bool) {
        // Transfer input asset from user into app custody first.
        self.transfer_in_trade(&trade, &signature_hex, trade.amount).await;
        self.execute_trade_from_escrow(trade, is_buy).await;
    }

    async fn execute_trade_from_escrow(&mut self, trade: TradeRequest, is_buy: bool) {
        let symbol = trade.symbol.clone();
        let config = self
            .state
            .pools
            .get(&symbol)
            .await
            .expect("Failed to read pool config")
            .expect("Pool not found");

        let mut wlin = self
            .state
            .wlin_reserves
            .get(&symbol)
            .await
            .expect("Failed to read wLin reserve")
            .unwrap_or_default();
        let mut token = self
            .state
            .token_reserves
            .get(&symbol)
            .await
            .expect("Failed to read token reserve")
            .unwrap_or_default();

        let fee_bps = config.fee_bps as u128;
        let amount_in = trade.amount;

        let (wlin_out, token_out, fee_amount) = if is_buy {
            let dx = amount_in.to_attos();
            let fee = dx.saturating_mul(fee_bps).saturating_div(10_000);
            let dx_after_fee = dx.saturating_sub(fee);

            let base_attos = wlin.to_attos();
            let token_attos = token.to_attos();
            let v_x = config.v_x.to_attos();
            let v_y = config.v_y.to_attos();
            let k = base_attos
                .saturating_add(v_x)
                .saturating_mul(token_attos.saturating_add(v_y));

            let new_token_attos = k
                .saturating_div(base_attos.saturating_add(v_x).saturating_add(dx_after_fee))
                .saturating_sub(v_y);
            let y_out = token_attos.saturating_sub(new_token_attos);
            (Amount::ZERO, Amount::from_attos(y_out), Amount::from_attos(fee))
        } else {
            let dy = amount_in.to_attos();
            let base_attos = wlin.to_attos();
            let token_attos = token.to_attos();
            let v_x = config.v_x.to_attos();
            let v_y = config.v_y.to_attos();
            let k = base_attos
                .saturating_add(v_x)
                .saturating_mul(token_attos.saturating_add(v_y));

            let new_base_attos = k
                .saturating_div(token_attos.saturating_add(v_y).saturating_add(dy))
                .saturating_sub(v_x);
            let x_out = base_attos.saturating_sub(new_base_attos);
            let fee = x_out.saturating_mul(fee_bps).saturating_div(10_000);
            let x_out_after_fee = x_out.saturating_sub(fee);
            (Amount::from_attos(x_out_after_fee), Amount::ZERO, Amount::from_attos(fee))
        };

        if is_buy {
            if token_out < trade.min_out {
                panic!("Min out not satisfied");
            }
            let dx = amount_in.to_attos();
            let fee = dx.saturating_mul(fee_bps).saturating_div(10_000);
            let dx_after_fee = dx.saturating_sub(fee);
            wlin = Amount::from_attos(wlin.to_attos().saturating_add(dx_after_fee));
            token = Amount::from_attos(token.to_attos().saturating_sub(token_out.to_attos()));

            // Send tokens from app custody to user.
            self.transfer_out_token(&trade.symbol, trade.owner, token_out).await;
        } else {
            if wlin_out < trade.min_out {
                panic!("Min out not satisfied");
            }
            let base_attos = wlin.to_attos();
            let token_attos = token.to_attos();
            let dy = amount_in.to_attos();
            let x_out_before_fee = wlin_out
                .to_attos()
                .saturating_mul(10_000)
                .saturating_div(10_000 - fee_bps);
            wlin = Amount::from_attos(base_attos.saturating_sub(x_out_before_fee));
            token = Amount::from_attos(token_attos.saturating_add(dy));

            // Send wLin from app custody to user.
            self.transfer_out_wlin(trade.owner, wlin_out).await;
        }

        // Credit fees to the operator fee destination in wLin.
        if let Some(fee_dest) = self.state.fee_destination.get().clone() {
            if fee_amount > Amount::ZERO {
                self.transfer_out_wlin(fee_dest, fee_amount).await;
            }
        }

        self.state
            .wlin_reserves
            .insert(&symbol, wlin)
            .expect("Failed to update wLin reserve");
        self.state
            .token_reserves
            .insert(&symbol, token)
            .expect("Failed to update token reserve");

        if wlin >= config.graduation_base_reserve {
            self.state
                .lp_enabled
                .insert(&symbol, true)
                .expect("Failed to enable LPs");
        }
    }

    async fn transfer_in_trade(&mut self, trade: &TradeRequest, signature_hex: &str, amount: Amount) {
        let app_owner: AccountOwner = self.runtime.application_id().into();
        if trade.side == Side::Buy {
            let wlin = self
                .state
                .wlin_app_id
                .get()
                .clone()
                .expect("wLin app id not set")
                .with_abi::<FungibleTokenAbi>();
            let op = FungibleOperation::TransferFrom {
                request: SignedTransferFromRequest {
                    payload: fungible_token::TransferFromRequest {
                        owner: trade.owner,
                        spender: app_owner,
                        amount,
                        target_account: Account {
                            chain_id: self.runtime.chain_id(),
                            owner: app_owner,
                        },
                    },
                    signature_hex: String::new(),
                },
            };
            self.runtime.call_application(true, wlin, &op);
        } else {
            let token_app_id = self
                .state
                .token_app_id_by_symbol
                .get(&trade.symbol)
                .await
                .expect("Failed to read token app id")
                .expect("Token app id not found")
                .with_abi::<FungibleTokenAbi>();
            let op = FungibleOperation::TransferFrom {
                request: SignedTransferFromRequest {
                    payload: fungible_token::TransferFromRequest {
                        owner: trade.owner,
                        spender: app_owner,
                        amount,
                        target_account: Account {
                            chain_id: self.runtime.chain_id(),
                            owner: app_owner,
                        },
                    },
                    signature_hex: String::new(),
                },
            };
            self.runtime.call_application(true, token_app_id, &op);
        }
    }

    async fn transfer_in_intent(
        &mut self,
        intent: &shared_types::Intent,
        signature_hex: &str,
        amount: Amount,
    ) {
        let app_owner: AccountOwner = self.runtime.application_id().into();
        if intent.side == Side::Buy {
            let wlin = self
                .state
                .wlin_app_id
                .get()
                .clone()
                .expect("wLin app id not set")
                .with_abi::<FungibleTokenAbi>();
            let op = FungibleOperation::TransferFrom {
                request: SignedTransferFromRequest {
                    payload: fungible_token::TransferFromRequest {
                        owner: intent.owner,
                        spender: app_owner,
                        amount,
                        target_account: Account {
                            chain_id: self.runtime.chain_id(),
                            owner: app_owner,
                        },
                    },
                    signature_hex: String::new(),
                },
            };
            self.runtime.call_application(true, wlin, &op);
        } else {
            let token_app_id = self
                .state
                .token_app_id_by_symbol
                .get(&intent.symbol)
                .await
                .expect("Failed to read token app id")
                .expect("Token app id not found")
                .with_abi::<FungibleTokenAbi>();
            let op = FungibleOperation::TransferFrom {
                request: SignedTransferFromRequest {
                    payload: fungible_token::TransferFromRequest {
                        owner: intent.owner,
                        spender: app_owner,
                        amount,
                        target_account: Account {
                            chain_id: self.runtime.chain_id(),
                            owner: app_owner,
                        },
                    },
                    signature_hex: String::new(),
                },
            };
            self.runtime.call_application(true, token_app_id, &op);
        }
    }

    async fn transfer_out_wlin(&mut self, owner: AccountOwner, amount: Amount) {
        let app_owner: AccountOwner = self.runtime.application_id().into();
        let wlin = self
            .state
            .wlin_app_id
            .get()
            .clone()
            .expect("wLin app id not set")
            .with_abi::<FungibleTokenAbi>();
        let op = FungibleOperation::Transfer {
            request: SignedTransferRequest {
                payload: fungible_token::TransferRequest {
                    owner: app_owner,
                    amount,
                    target_account: Account {
                        chain_id: self.runtime.chain_id(),
                        owner,
                    },
                },
                signature_hex: String::new(),
            },
        };
        self.runtime.call_application(true, wlin, &op);
    }

    async fn transfer_out_token(&mut self, symbol: &str, owner: AccountOwner, amount: Amount) {
        let app_owner: AccountOwner = self.runtime.application_id().into();
        let token_app_id = self
            .state
            .token_app_id_by_symbol
            .get(symbol)
            .await
            .expect("Failed to read token app id")
            .expect("Token app id not found")
            .with_abi::<FungibleTokenAbi>();
        let op = FungibleOperation::Transfer {
            request: SignedTransferRequest {
                payload: fungible_token::TransferRequest {
                    owner: app_owner,
                    amount,
                    target_account: Account {
                        chain_id: self.runtime.chain_id(),
                        owner,
                    },
                },
                signature_hex: String::new(),
            },
        };
        self.runtime.call_application(true, token_app_id, &op);
    }

    async fn current_price(&self, symbol: &str) -> Amount {
        let config = self
            .state
            .pools
            .get(symbol)
            .await
            .expect("Failed to read pool config")
            .expect("Pool not found");
        let x = self
            .state
            .wlin_reserves
            .get(symbol)
            .await
            .expect("Failed to read wLin reserve")
            .unwrap_or_default()
            .to_attos();
        let y = self
            .state
            .token_reserves
            .get(symbol)
            .await
            .expect("Failed to read token reserve")
            .unwrap_or_default()
            .to_attos();
        let v_x = config.v_x.to_attos();
        let v_y = config.v_y.to_attos();
        let price_attos = (x.saturating_add(v_x))
            .saturating_mul(Amount::ONE.to_attos())
            .saturating_div(y.saturating_add(v_y));
        Amount::from_attos(price_attos)
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
