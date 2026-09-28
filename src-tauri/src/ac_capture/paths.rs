//! Locating the Assetto Corsa install and its Proton-prefix config.
//!
//! AC is a Windows game, so on this platform its *user* config doesn't live
//! next to the install — it's inside the Proton prefix, under a simulated
//! Windows `Documents` folder. The two therefore get resolved separately:
//! the install (game files, `apps/lua`, CSP's bundled defaults) and the
//! prefix config (`race.ini`, `video.ini`, the user's CSP overrides under
//! `cfg/extension`), which is what actually gets edited for a capture.

use std::path::{Path, PathBuf};

/// AC's Steam app id — names both the install folder lookup and the
/// `compatdata/<id>` prefix that holds its user config.
pub const AC_STEAM_APP_ID: &str = "244210";

/// Steam roots worth checking before parsing any library metadata. The
/// Flatpak entry matters because a Flatpak Steam keeps its whole library
/// tree under `~/.var/app`, where the native path doesn't exist at all.
fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".local/share/Steam"));
        roots.push(home.join(".steam/steam"));
        roots.push(home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"));
    }
    roots
}

/// Every Steam library on this machine, including ones on other drives.
///
/// Steam records extra libraries in `libraryfolders.vdf`, so a game very
/// often isn't under the main Steam root — this box, for instance, has
/// libraries on two additional mounts. The file is Valve's own KeyValues
/// format; rather than take a VDF dependency to read one field, this pulls
/// out the `"path"` values, which is all that's needed here.
fn steam_libraries() -> Vec<PathBuf> {
    let mut libraries = Vec::new();
    for root in steam_roots() {
        if root.is_dir() && !libraries.contains(&root) {
            libraries.push(root.clone());
        }
        let vdf = root.join("steamapps/libraryfolders.vdf");
        let Ok(text) = std::fs::read_to_string(&vdf) else {
            continue;
        };
        for line in text.lines() {
            let trimmed = line.trim();
            let Some(rest) = trimmed.strip_prefix("\"path\"") else {
                continue;
            };
            // Value is the quoted string after the key, with escaped
            // separators on Windows-authored files.
            let Some(start) = rest.find('"') else {
                continue;
            };
            let Some(end) = rest[start + 1..].find('"') else {
                continue;
            };
            let path = PathBuf::from(rest[start + 1..start + 1 + end].replace("\\\\", "/"));
            if path.is_dir() && !libraries.contains(&path) {
                libraries.push(path);
            }
        }
    }
    libraries
}

/// The `assettocorsa` install directory, if Steam has it anywhere.
pub fn detect_ac_install_dir() -> Option<PathBuf> {
    steam_libraries()
        .into_iter()
        .map(|library| library.join("steamapps/common/assettocorsa"))
        .find(|candidate| candidate.join("acs.exe").is_file())
}

/// AC's user config directory inside the Proton prefix — the one holding
/// `race.ini`, `video.ini` and `cfg/extension/*`.
///
/// The prefix lives in whichever library the game was installed into, so
/// this searches the same set rather than assuming the default root. Both
/// the localised and non-localised `Documents` spellings are checked
/// because the folder name depends on how the prefix was created.
pub fn detect_ac_user_dir() -> Option<PathBuf> {
    for library in steam_libraries() {
        let users = library
            .join("steamapps/compatdata")
            .join(AC_STEAM_APP_ID)
            .join("pfx/drive_c/users");
        let Ok(entries) = std::fs::read_dir(&users) else {
            continue;
        };
        for entry in entries.flatten() {
            for documents in ["Documents", "My Documents"] {
                let candidate = entry.path().join(documents).join("Assetto Corsa");
                if candidate.join("cfg").is_dir() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

/// Resolved locations a capture needs. Built once per run so a half-set
/// configuration fails up front with a clear message rather than part-way
/// through, after the user's config has already been swapped out.
#[derive(Debug, Clone)]
pub struct CapturePaths {
    /// The install (`acs.exe`, `apps/lua`, CSP's bundled config defaults).
    pub install_dir: PathBuf,
    /// User config root inside the prefix (parent of `cfg`).
    pub user_dir: PathBuf,
}

impl CapturePaths {
    /// Resolves both roots, preferring explicit settings over detection so
    /// a non-standard install can always be pointed at by hand.
    pub fn resolve(
        install_override: Option<&str>,
        user_override: Option<&str>,
    ) -> Result<Self, String> {
        let install_dir = install_override
            .filter(|value| !value.is_empty())
            .map(|value| Ok(expand_tilde(value)))
            .unwrap_or_else(|| {
                detect_ac_install_dir().ok_or_else(|| {
                    "Could not find an Assetto Corsa install. Set the path in Settings.".to_string()
                })
            })?;
        if !install_dir.join("acs.exe").is_file() {
            return Err(format!(
                "{} doesn't look like an Assetto Corsa install (no acs.exe).",
                install_dir.display()
            ));
        }

        let user_dir = user_override
            .filter(|value| !value.is_empty())
            .map(|value| Ok(expand_tilde(value)))
            .unwrap_or_else(|| {
                detect_ac_user_dir().ok_or_else(|| {
                    "Could not find Assetto Corsa's config folder inside the Proton prefix. \
                     Launch the game once, or set the path in Settings."
                        .to_string()
                })
            })?;
        if !user_dir.join("cfg").is_dir() {
            return Err(format!(
                "{} has no cfg folder — is that Assetto Corsa's user directory?",
                user_dir.display()
            ));
        }

        Ok(Self {
            install_dir,
            user_dir,
        })
    }

    pub fn cfg_dir(&self) -> PathBuf {
        self.user_dir.join("cfg")
    }

    pub fn race_ini(&self) -> PathBuf {
        self.cfg_dir().join("race.ini")
    }

    pub fn video_ini(&self) -> PathBuf {
        self.cfg_dir().join("video.ini")
    }

    /// The user's CSP overrides. CSP reads its defaults from the install's
    /// `extension/config`, but anything the user (or Content Manager)
    /// changed is written here, and this is the copy that wins — so it's
    /// the one a capture has to edit.
    pub fn ext_cfg_dir(&self) -> PathBuf {
        self.cfg_dir().join("extension")
    }

    pub fn ext_cfg(&self, filename: &str) -> PathBuf {
        self.ext_cfg_dir().join(filename)
    }

    /// Where this feature's CSP Lua app is installed.
    pub fn lua_app_dir(&self) -> PathBuf {
        self.install_dir.join("apps/lua").join(super::LUA_APP_NAME)
    }

    /// Where the Lua app leaves its output. Mirrors the `out` folder the
    /// script writes to, resolved from the Linux side.
    pub fn lua_out_dir(&self) -> PathBuf {
        self.lua_app_dir().join("out")
    }

    /// The game binary itself, as opposed to whatever launcher sits in front
    /// of it.
    pub fn acs_exe(&self) -> PathBuf {
        self.install_dir.join("acs.exe")
    }

    /// The Proton prefix directory (`compatdata/<appid>`).
    ///
    /// Derived by walking up from the user config directory, which lives
    /// deep inside it, so an explicitly-configured user directory still
    /// resolves rather than only auto-detected ones.
    pub fn compat_data_dir(&self) -> Option<PathBuf> {
        self.user_dir
            .ancestors()
            .find(|dir| {
                dir.file_name().is_some_and(|name| name == AC_STEAM_APP_ID)
                    && dir
                        .parent()
                        .and_then(|parent| parent.file_name())
                        .is_some_and(|name| name == "compatdata")
            })
            .map(Path::to_path_buf)
    }

    /// The Proton build this prefix was created with, and where to run it
    /// from.
    ///
    /// Needed because launching the game through Steam isn't reliable for
    /// automation: Content Manager installs itself *as* `AssettoCorsa.exe`
    /// (leaving the real launcher as `AssettoCorsa_original.exe`), so
    /// `steam://rungameid/...` opens CM's UI and waits for someone to click
    /// Drive. Running `acs.exe` directly inside the same prefix skips that
    /// entirely.
    ///
    /// Proton records the tool it used in `compatdata/<appid>/config_info`,
    /// first line, so the right build is read rather than guessed — this
    /// prefix is on GE-Proton, which no amount of assuming stock Proton
    /// would have found.
    pub fn proton_binary(&self) -> Option<PathBuf> {
        let compat = self.compat_data_dir()?;
        let info = std::fs::read_to_string(compat.join("config_info")).ok()?;
        let tool = info.lines().next()?.trim().to_string();
        if tool.is_empty() {
            return None;
        }

        // Custom builds (GE-Proton and friends) live under the Steam root;
        // official ones are installed as ordinary apps in a library.
        let mut candidates: Vec<PathBuf> = steam_roots()
            .into_iter()
            .map(|root| root.join("compatibilitytools.d").join(&tool).join("proton"))
            .collect();
        candidates.extend(
            steam_libraries()
                .into_iter()
                .map(|library| library.join("steamapps/common").join(&tool).join("proton")),
        );
        candidates.into_iter().find(|path| path.is_file())
    }

    /// Steam's own install directory, which Proton wants as
    /// `STEAM_COMPAT_CLIENT_INSTALL_PATH`.
    pub fn steam_client_dir(&self) -> Option<PathBuf> {
        steam_roots().into_iter().find(|root| root.is_dir())
    }
}

/// The Steam launch options configured for `app_id`, if any.
///
/// Read because a capture starts `acs.exe` directly and so bypasses Steam,
/// and with it everything the user configured there. That matters concretely:
/// simd's automatic bridging only works when the *game* process carries
/// `SIMD_BRIDGE_EXE`, which on this setup is set exactly once — in Steam's
/// launch options. A capture-launched session without it produces no
/// telemetry at all, which looks like a bug and isn't.
///
/// Mirroring what Steam would have applied keeps a captured session
/// behaving like a played one, without asking for the same values twice.
pub fn steam_launch_options(app_id: &str) -> Option<String> {
    for root in steam_roots() {
        let Ok(entries) = std::fs::read_dir(root.join("userdata")) else {
            continue;
        };
        for entry in entries.flatten() {
            let config = entry.path().join("config/localconfig.vdf");
            let Ok(text) = std::fs::read_to_string(&config) else {
                continue;
            };
            if let Some(options) = launch_options_for(&text, app_id) {
                return Some(options);
            }
        }
    }
    None
}

/// Pulls one app's `LaunchOptions` out of a `localconfig.vdf`.
///
/// Scans rather than parsing the whole KeyValues document: only one string is
/// wanted, and a full VDF parser is a dependency's worth of work for it. The
/// search is bounded to the lines following the app's own id and stops at the
/// next id, so a value can't be picked up from a neighbouring app.
fn launch_options_for(text: &str, app_id: &str) -> Option<String> {
    let app_key = format!("\"{app_id}\"");
    let mut depth: i32 = 0;
    // Depth the app's own block sits at, once found. Tracking it is what
    // makes nesting safe: an app block contains further sections of its own
    // (`"cloud"` sits between the id and `LaunchOptions` in a real file), and
    // treating any bare key as a sibling reset the search before reaching the
    // value.
    let mut app_depth: Option<i32> = None;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed == "{" {
            depth += 1;
            continue;
        }
        if trimmed == "}" {
            depth -= 1;
            if app_depth.is_some_and(|d| depth <= d) {
                app_depth = None;
            }
            continue;
        }

        // Two quotes is a bare key on its own line (a section header); four
        // is a key/value pair. Counting them separates the two, where
        // "starts and ends with a quote" does not — a `"Key"  "value"` line
        // satisfies that as well.
        match trimmed.matches('"').count() {
            2 if app_depth.is_none() && trimmed == app_key => app_depth = Some(depth),
            4 if app_depth.is_some() => {
                if let Some(rest) = trimmed.strip_prefix("\"LaunchOptions\"") {
                    let start = rest.find('"')? + 1;
                    let end = rest[start..].rfind('"')?;
                    return Some(rest[start..start + end].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

/// The leading `VAR=value` assignments from a Steam launch-options string.
///
/// Steam's convention puts environment assignments before `%command%`, which
/// stands in for the game's own executable. Everything from `%command%`
/// onwards is the command and its arguments, not environment, so parsing
/// stops there. Tokens that aren't assignments (a wrapper like `gamescope`)
/// are skipped rather than guessed at — this only claims to recover the
/// environment, not to reproduce a wrapper chain.
pub fn env_assignments(launch_options: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for token in launch_options.split_whitespace() {
        if token == "%command%" {
            break;
        }
        let Some((key, value)) = token.split_once('=') else {
            continue;
        };
        let looks_like_env = !key.is_empty()
            && key
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
        if looks_like_env {
            // `~` is the shell's, not the kernel's: Steam expands it when it
            // runs the command line, so a value copied verbatim would be a
            // path that doesn't exist.
            out.push((key.to_string(), expand_tilde(value).display().to_string()));
        }
    }
    out
}

fn expand_tilde(value: &str) -> PathBuf {
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reports what detection finds on the machine it's run on.
    ///
    /// `#[ignore]` because it asserts against a real Assetto Corsa install,
    /// which no CI runner has — run it by hand
    /// (`cargo test -p typiql detects_a_real_install -- --ignored --nocapture`)
    /// when checking a rig, where it doubles as the diagnostic for "why
    /// can't TyPiQL find my game".
    #[test]
    fn reads_launch_options_for_the_right_app() {
        let vdf = "\t\t\t\t\t\"244210\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"MINE=1 %command%\"\n\t\t\t\t\t}\n\
                   \t\t\t\t\t\"999\"\n\t\t\t\t\t{\n\t\t\t\t\t\t\"LaunchOptions\"\t\t\"OTHER=2 %command%\"\n\t\t\t\t\t}\n";
        assert_eq!(
            launch_options_for(vdf, "244210").as_deref(),
            Some("MINE=1 %command%")
        );
        assert_eq!(
            launch_options_for(vdf, "999").as_deref(),
            Some("OTHER=2 %command%")
        );
        assert_eq!(launch_options_for(vdf, "12345"), None);
    }

    #[test]
    fn looks_past_sections_nested_inside_the_app_block() {
        // Shape taken from a real localconfig.vdf, where `"cloud"` sits
        // between the app id and its LaunchOptions. Treating that bare key as
        // a sibling app abandoned the search and returned None.
        let vdf = "\t\"244210\"\n\t{\n\t\t\"LastPlayed\"\t\t\"1788309396\"\n\
                   \t\t\"cloud\"\n\t\t{\n\t\t\t\"last_sync_state\"\t\t\"synchronized\"\n\t\t}\n\
                   \t\t\"LaunchOptions\"\t\t\"PROTON_ENABLE_WAYLAND=1 %command%\"\n\t}\n";
        assert_eq!(
            launch_options_for(vdf, "244210").as_deref(),
            Some("PROTON_ENABLE_WAYLAND=1 %command%")
        );
    }

    #[test]
    fn stops_at_the_end_of_the_app_block() {
        // A neighbouring app's options must not be attributed to this one.
        let vdf = "\t\"244210\"\n\t{\n\t\t\"Playtime\"\t\t\"1\"\n\t}\n\
                   \t\"244850\"\n\t{\n\t\t\"LaunchOptions\"\t\t\"OTHER=1 %command%\"\n\t}\n";
        assert_eq!(launch_options_for(vdf, "244210"), None);
    }

    #[test]
    fn takes_only_the_environment_before_the_command() {
        let assignments = env_assignments(
            "SIMD_BRIDGE_EXE=/opt/acbridge.exe PROTON_ENABLE_WAYLAND=1 %command% -someArg FOO=bar",
        );
        let keys: Vec<&str> = assignments.iter().map(|(k, _)| k.as_str()).collect();
        // Everything after %command% is the game's own arguments, so an
        // assignment-looking token there must not become an env var.
        assert_eq!(keys, vec!["SIMD_BRIDGE_EXE", "PROTON_ENABLE_WAYLAND"]);
        assert_eq!(assignments[0].1, "/opt/acbridge.exe");
    }

    #[test]
    fn skips_wrappers_and_expands_home() {
        let assignments =
            env_assignments("gamescope -W 1920 SIMD_BRIDGE_EXE=~/bridge.exe %command%");
        assert_eq!(assignments.len(), 1, "a wrapper token is not an assignment");
        assert!(
            !assignments[0].1.starts_with('~'),
            "`~` is the shell's; Steam expands it, so a verbatim copy would not exist"
        );
    }

    #[test]
    #[ignore]
    fn detects_a_real_install() {
        let paths = CapturePaths::resolve(None, None).expect("no Assetto Corsa install detected");
        println!("install:  {}", paths.install_dir.display());
        println!("user cfg: {}", paths.cfg_dir().display());
        println!("lua app:  {}", paths.lua_app_dir().display());
        println!("prefix:   {:?}", paths.compat_data_dir());
        let options = steam_launch_options(AC_STEAM_APP_ID);
        println!("launch:   {options:?}");
        if let Some(options) = &options {
            for (key, value) in env_assignments(options) {
                println!("   env:   {key}={value}");
            }
        }
        println!("proton:   {:?}", paths.proton_binary());
        println!("steam:    {:?}", paths.steam_client_dir());

        assert!(paths.install_dir.join("acs.exe").is_file());
        assert!(paths.race_ini().is_file(), "no race.ini — launch AC once");
        assert!(
            paths.install_dir.join("extension").is_dir(),
            "no CSP found; this feature needs Custom Shaders Patch"
        );
    }
}
