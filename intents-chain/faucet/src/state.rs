//! On-chain state for the faucet app.

use linera_base::identifiers::ApplicationId;
use linera_sdk::linera_base_types::{AccountOwner, Amount};
use linera_sdk::views::{linera_views, MapView, RegisterView, RootView, ViewStorageContext};

#[derive(RootView)]
#[view(context = ViewStorageContext)]
pub struct FaucetState {
    /// wLin application id (pricing asset).
    pub wlin_app_id: RegisterView<Option<ApplicationId>>,
    /// Per-user faucet cap.
    pub faucet_cap: RegisterView<Amount>,
    /// Amount minted per user.
    pub minted_by_owner: MapView<AccountOwner, Amount>,
}
