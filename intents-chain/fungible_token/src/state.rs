//! On-chain state for the signed fungible token app.

use linera_sdk::linera_base_types::{AccountOwner, Amount};
use linera_sdk::views::{linera_views, MapView, RootView, ViewStorageContext};

/// Persistent balances and allowances.
#[derive(RootView)]
#[view(context = ViewStorageContext)]
pub struct FungibleState {
    /// Balance per owner.
    pub balances: MapView<AccountOwner, Amount>,
    /// Allowances per (owner, spender).
    pub allowances: MapView<(AccountOwner, AccountOwner), Amount>,
}
