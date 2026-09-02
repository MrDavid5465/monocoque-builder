//! Installing the telemetry Lua app into Assetto Corsa.
//!
//! Same embedding approach as the capture app: the files are compiled into
//! the binary rather than shipped as bundle resources, because this app ships
//! as deb, rpm, AppImage and Flatpak and each resolves resource paths
//! differently — the Flatpak one from inside a sandbox. Embedding removes the
//! runtime path question entirely and guarantees the installed script matches
//! the binary that installed it.

use crate::ac_capture::paths::CapturePaths;
use std::path::PathBuf;

const MANIFEST: &str = include_str!("lua_app/manifest.ini");
const SCRIPT: &str = include_str!("lua_app/typiql_telemetry.lua");
const ICON: &[u8] = include_bytes!("lua_app/icon.png");

/// Where the app lives inside the game.
pub fn app_dir(paths: &CapturePaths) -> PathBuf {
    paths.install_dir.join("apps/lua").join(super::LUA_APP_NAME)
}

/// Whether the app is present in the game's `apps/lua`.
///
/// Only checks the entry script: an install that lost its manifest is broken
/// either way, and this is used to decide whether to offer the feature, not
/// to validate it.
pub fn is_installed(paths: &CapturePaths) -> bool {
    app_dir(paths)
        .join(format!("{}.lua", super::LUA_APP_NAME))
        .is_file()
}

/// Writes the app into the game, overwriting any previous copy.
///
/// Rewritten rather than skipped-if-present so a stale script from an older
/// TyPiQL can't keep sending frames in a format this build no longer expects.
pub fn install(paths: &CapturePaths) -> Result<(), String> {
    let dir = app_dir(paths);
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("Couldn't create {}: {err}", dir.display()))?;

    let write = |name: String, bytes: &[u8]| -> Result<(), String> {
        let path = dir.join(name);
        std::fs::write(&path, bytes)
            .map_err(|err| format!("Couldn't write {}: {err}", path.display()))
    };

    write("manifest.ini".to_string(), MANIFEST.as_bytes())?;
    // CSP requires the entry script to be named after its folder.
    write(format!("{}.lua", super::LUA_APP_NAME), SCRIPT.as_bytes())?;
    write("icon.png".to_string(), ICON)?;
    Ok(())
}

/// Removes the app.
///
/// Worth having as a first-class action rather than leaving people to delete
/// folders: this thing autoruns with the game and opens a socket, so there
/// should be an obvious way to stop it doing that.
pub fn uninstall(paths: &CapturePaths) -> Result<(), String> {
    let dir = app_dir(paths);
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("Couldn't remove {}: {err}", dir.display())),
    }
}
