use linera_base::crypto::AccountSecretKey;
use linera_base::identifiers::AccountOwner;
use rand::rngs::OsRng;

fn main() {
    let mut rng = OsRng;
    let secret = AccountSecretKey::generate_from(&mut rng);
    let public = secret.public();
    let owner = AccountOwner::from(public);

    let secret_json = serde_json::to_string(&secret).expect("serialize secret");
    // secret_json looks like {"Ed25519":"..."}; extract the inner hex
    let secret_hex = secret_json
        .split('"')
        .nth(3)
        .expect("secret hex");

    println!("OWNER={}", owner);
    println!("SECRET_HEX={}", secret_hex);
}
