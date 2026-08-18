fn main() {
    println!("cargo:rerun-if-changed=../overlay");
    tauri_build::build()
}
