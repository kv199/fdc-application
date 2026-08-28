use std::{fs, io, path::Path};

fn watch_frontend_path(path: &Path) -> io::Result<()> {
    println!("cargo:rerun-if-changed={}", path.display());
    if path.is_dir() {
        for entry in fs::read_dir(path)? {
            watch_frontend_path(&entry?.path())?;
        }
    }
    Ok(())
}

fn main() {
    watch_frontend_path(Path::new("../overlay")).expect("unable to watch frontend assets");
    tauri_build::build()
}
