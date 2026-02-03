use anyhow::{anyhow, Result};
use linera_base::crypto::{AccountSecretKey, BcsSignable, Ed25519SecretKey};
use shared_types::{CreateTokenRequest, Side, TokenMetadata, TradeRequest};
use std::env;
use std::str::FromStr;

fn required_env(name: &str) -> Result<String> {
    env::var(name).map_err(|_| anyhow!("Missing env var {}", name))
}

fn optional_env(name: &str) -> Option<String> {
    env::var(name).ok()
}

fn sign_and_hex<T>(secret: &AccountSecretKey, payload: &T) -> Result<String>
where
    for<'de> T: BcsSignable<'de>,
{
    let signature = secret.sign(payload);
    let signature_bytes = bcs::to_bytes(&signature)?;
    Ok(hex::encode(signature_bytes))
}

fn main() -> Result<()> {
    // Inputs via env vars for simplicity.
    let owner = required_env("OWNER")?;
    let name = required_env("NAME")?;
    let symbol = required_env("SYMBOL")?;
    let decimals: u8 = required_env("DECIMALS")?.parse()?;
    let initial_supply = required_env("INITIAL_SUPPLY")?;
    let secret_hex = required_env("SECRET_HEX")?;

    let owner = linera_base::identifiers::AccountOwner::from_str(&owner)?;
    let initial_supply = linera_base::data_types::Amount::from_str(&initial_supply)?;

    let payload = CreateTokenRequest {
        owner,
        metadata: TokenMetadata {
            name,
            symbol: symbol.clone(),
            decimals,
        },
        initial_supply,
    };

    // Ed25519 secret key is serialized as a hex string.
    let secret: Ed25519SecretKey = serde_json::from_str(&format!("\"{}\"", secret_hex))?;
    let secret = AccountSecretKey::Ed25519(secret);

    let signature_hex = sign_and_hex(&secret, &payload)?;

    println!("CREATE_TOKEN_SIG={}", signature_hex);

    // Optional: Approve signatures (fungible token).
    if let (Some(spender_app_id), Some(wlin_allowance)) = (
        optional_env("SPENDER_APP_ID"),
        optional_env("WLIN_ALLOWANCE"),
    ) {
        let spender = linera_base::identifiers::ApplicationId::from_str(&spender_app_id)?;
        let allowance = linera_base::data_types::Amount::from_str(&wlin_allowance)?;
        let approve_payload = fungible_token::ApproveRequest {
            owner: owner.clone(),
            spender: spender.into(),
            allowance,
        };
        let sig = sign_and_hex(&secret, &approve_payload)?;
        println!("WLIN_APPROVE_SIG={}", sig);
    }

    if let (Some(spender_app_id), Some(tst_allowance)) = (
        optional_env("SPENDER_APP_ID"),
        optional_env("TST_ALLOWANCE"),
    ) {
        let spender = linera_base::identifiers::ApplicationId::from_str(&spender_app_id)?;
        let allowance = linera_base::data_types::Amount::from_str(&tst_allowance)?;
        let approve_payload = fungible_token::ApproveRequest {
            owner: owner.clone(),
            spender: spender.into(),
            allowance,
        };
        let sig = sign_and_hex(&secret, &approve_payload)?;
        println!("TST_APPROVE_SIG={}", sig);
    }

    // Optional: Buy/Sell trade signatures (matching_engine).
    if let (Some(buy_amount), Some(buy_min_out)) =
        (optional_env("BUY_AMOUNT"), optional_env("BUY_MIN_OUT"))
    {
        let amount = linera_base::data_types::Amount::from_str(&buy_amount)?;
        let min_out = linera_base::data_types::Amount::from_str(&buy_min_out)?;
        let buy_payload = TradeRequest {
            owner: owner.clone(),
            symbol: symbol.clone(),
            side: Side::Buy,
            amount,
            min_out,
        };
        let sig = sign_and_hex(&secret, &buy_payload)?;
        println!("BUY_SIG={}", sig);
    }

    if let (Some(sell_amount), Some(sell_min_out)) =
        (optional_env("SELL_AMOUNT"), optional_env("SELL_MIN_OUT"))
    {
        let amount = linera_base::data_types::Amount::from_str(&sell_amount)?;
        let min_out = linera_base::data_types::Amount::from_str(&sell_min_out)?;
        let sell_payload = TradeRequest {
            owner,
            symbol: symbol.clone(),
            side: Side::Sell,
            amount,
            min_out,
        };
        let sig = sign_and_hex(&secret, &sell_payload)?;
        println!("SELL_SIG={}", sig);
    }
    Ok(())
}
