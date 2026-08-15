fn main() {
    // Cargo reports custom profiles inheriting from `release` as PROFILE=release.
    // The develop profile explicitly keeps limited debug info, while production
    // release builds keep debug info disabled.
    let is_develop = std::env::var("DEBUG").as_deref() == Ok("true");
    let channel = if is_develop { "develop" } else { "production" };

    println!("cargo:rerun-if-env-changed=PROFILE");
    println!("cargo:rustc-env=HUD_CHANNEL={channel}");
    tauri_build::build()
}
