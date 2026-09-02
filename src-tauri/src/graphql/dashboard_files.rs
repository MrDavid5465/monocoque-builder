use crate::typiql_types::{DashboardEntry, DashboardEntryChanged, File};
use async_graphql::{Context, Object, Result as GqlResult};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use typiql::{Location, TypiQLBroker};

#[derive(Default)]
pub struct DashboardFileSyncQuery;

/// Called when the user opens a dashboard view. Reconciles the JSON store
/// with what is actually on disk, tracking each sprite/asset as a `File`
/// record (content-hash-addressed, matching `car.rs`'s `sync_car_photos`
/// pattern) scoped into this dashboard's own `.dashboard.json` `files`
/// table — not a global collection, so a dashboard's file inventory travels
/// with its folder the same way its config does.
///
///   - Files found on disk with no record → added.
///   - Files whose content changed since the last sync → `id`/`url` refreshed.
///   - Records whose file is gone from disk → dropped (no `missing` flag —
///     the table only ever reflects what's actually there right now).
///
/// Returns the full, up-to-date list of File records for the dashboard.
#[Object]
impl DashboardFileSyncQuery {
    async fn sync_dashboard_files(
        &self,
        ctx: &Context<'_>,
        dashboard_id: String,
    ) -> GqlResult<Vec<File>> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let entry: DashboardEntry = adapter
            .get_one(
                Location::Named("dashboard_entries".to_string()),
                "id",
                &dashboard_id,
            )
            .await
            .ok_or_else(|| async_graphql::Error::new("Dashboard not found"))
            .and_then(|v| {
                serde_json::from_value(v).map_err(|e| async_graphql::Error::new(e.to_string()))
            })?;

        let base_path = expand_tilde(&entry.path);
        let files_location = || Location::At {
            file: content_file(&entry.path),
            table: "files".to_string(),
        };

        // Maintain a symlink so the static file server can serve assets without
        // exposing arbitrary filesystem paths via /file-proxy.
        // In dev mode use a path outside src-tauri/ to avoid triggering Tauri's file watcher.
        let link_root: PathBuf = if cfg!(debug_assertions) {
            PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../data/dash-assets"))
        } else {
            PathBuf::from("data/dash-assets")
        };
        std::fs::create_dir_all(&link_root).ok();
        let link = link_root.join(&dashboard_id);
        // Remove stale symlink (path may have changed).
        if link.is_symlink() || link.exists() {
            std::fs::remove_file(&link).ok();
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&base_path, &link).ok();

        // Remove leftover symlink from the old dev-mode location inside src-tauri/.
        // Those symlinks are inside Tauri's watched tree and trigger spurious rebuilds.
        #[cfg(debug_assertions)]
        {
            let old_link = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/data/dash-assets"))
                .join(&dashboard_id);
            if old_link.is_symlink() || old_link.exists() {
                std::fs::remove_file(&old_link).ok();
            }
        }

        // Ensure the directory exists.
        std::fs::create_dir_all(&base_path).ok();

        // Walk the directory; seed with mock sprites if no images are present yet.
        let mut disk_files = walk_dir(&base_path, &base_path);
        let image_exts: HashSet<&str> = ["png", "jpg", "jpeg", "webp", "svg", "gif"]
            .iter()
            .copied()
            .collect();
        let has_images = disk_files.iter().any(|f| {
            Path::new(f)
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| image_exts.contains(e.to_lowercase().as_str()))
                .unwrap_or(false)
        });
        if !has_images {
            let mock_dir = mock_sprites_dir();
            if mock_dir.exists() {
                for entry in std::fs::read_dir(&mock_dir).into_iter().flatten().flatten() {
                    let dest = base_path.join(entry.file_name());
                    if !dest.exists() {
                        std::fs::copy(entry.path(), &dest).ok();
                    }
                }
                disk_files = walk_dir(&base_path, &base_path);
            }
        }

        let existing: HashMap<String, File> = adapter
            .get_many(files_location(), vec![])
            .await
            .into_iter()
            .filter_map(|v| serde_json::from_value::<File>(v).ok())
            .map(|f| (f.path.clone(), f))
            .collect();

        let mut current: Vec<Value> = Vec::with_capacity(disk_files.len());
        for rel_path in &disk_files {
            let real_path = base_path.join(rel_path);
            let path_str = real_path.to_string_lossy().to_string();
            let filename = Path::new(rel_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(rel_path)
                .to_string();
            let url = format!("/dash-assets/{}/{}", dashboard_id, rel_path);

            let mtime = file_mtime_secs(&real_path);
            let existing_record = existing.get(&path_str);

            // Re-reading and SHA-256-hashing every file's full content on every
            // dashboard open used to take 5+ seconds for a folder with a few
            // multi-MB 360 photos — that stall is what made the 360 viewer (or
            // any sprite-dependent element) appear blank until it finished. A
            // file's content can only change by being rewritten, which always
            // bumps its mtime, so reuse the existing hash whenever mtime is
            // present and unchanged; only fall back to a full read+hash for new
            // files, files with no recorded mtime yet, or files that actually
            // changed. This preserves "auto-detect files edited outside the
            // app" exactly — nothing here weakens that guarantee.
            let hash = match (existing_record, mtime) {
                (Some(rec), Some(mt)) if rec.mtime == Some(mt) => rec.id.clone(),
                _ => std::fs::read(&real_path)
                    .ok()
                    .map(|bytes| {
                        use sha2::{Digest, Sha256};
                        let mut hasher = Sha256::new();
                        hasher.update(&bytes);
                        format!("{:x}", hasher.finalize())
                    })
                    .unwrap_or_default(),
            };

            current.push(json!({ "path": path_str, "id": hash, "filename": filename, "url": url, "mtime": mtime }));
        }

        // Only write back if something actually changed — avoids a spurious
        // disk write (and .dashboard.json churn) on every dashboard open.
        // Must compare mtime too, not just id: a record whose content hash is
        // unchanged but whose mtime was just backfilled (e.g. the first sync
        // after upgrading existing records to carry mtime) still needs to be
        // persisted, or the fast path above never gets anything to compare
        // against and every future sync falls back to a full re-hash forever.
        let existing_matches = existing.len() == current.len()
            && current.iter().all(|c| {
                let path = c.get("path").and_then(Value::as_str).unwrap_or_default();
                existing
                    .get(path)
                    .map(|f| {
                        f.id == c.get("id").and_then(Value::as_str).unwrap_or_default()
                            && f.mtime == c.get("mtime").and_then(Value::as_i64)
                    })
                    .unwrap_or(false)
            });
        if !existing_matches {
            adapter.set_table(files_location(), current).await;
        }

        adapter
            .get_many(files_location(), vec![])
            .await
            .into_iter()
            .map(|v| {
                serde_json::from_value::<File>(v)
                    .map_err(|e| async_graphql::Error::new(e.to_string()))
            })
            .collect()
    }
}

#[derive(Default)]
pub struct DashboardFileUploadMutation;

#[Object]
impl DashboardFileUploadMutation {
    /// Write a file into the dashboard directory and upsert its `File`
    /// record (content-hash-addressed) in this dashboard's own
    /// `.dashboard.json` `files` table. `name` is the relative path within
    /// the dashboard (e.g. `"thumbnail.png"` or `"sprites/car.svg"`). `data`
    /// is base64-encoded, optionally prefixed with a data-URL header
    /// (`data:image/png;base64,...`).
    async fn upload_dashboard_file(
        &self,
        ctx: &Context<'_>,
        dashboard_id: String,
        name: String,
        data: String,
        #[graphql(default)] _file_type: Option<String>,
    ) -> GqlResult<File> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let entry: DashboardEntry = adapter
            .get_one(
                Location::Named("dashboard_entries".to_string()),
                "id",
                &dashboard_id,
            )
            .await
            .ok_or_else(|| async_graphql::Error::new("Dashboard not found"))
            .and_then(|v| {
                serde_json::from_value(v).map_err(|e| async_graphql::Error::new(e.to_string()))
            })?;

        // Strip data-URL prefix if present.
        let b64 = match data.find(',') {
            Some(pos) => &data[pos + 1..],
            None => &data,
        };
        use base64::prelude::*;
        let bytes = BASE64_STANDARD
            .decode(b64)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;

        // Write file to disk.
        let base_path = expand_tilde(&entry.path);
        let file_path = base_path.join(&name);
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        }
        std::fs::write(&file_path, &bytes).map_err(|e| async_graphql::Error::new(e.to_string()))?;

        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let hash = format!("{:x}", hasher.finalize());
        let path_str = file_path.to_string_lossy().to_string();
        let url = format!("/dash-assets/{}/{}", dashboard_id, name);
        let mtime = file_mtime_secs(&file_path);

        let files_location = Location::At {
            file: content_file(&entry.path),
            table: "files".to_string(),
        };
        let mut rows = adapter.get_many(files_location.clone(), vec![]).await;
        rows.retain(|v| v.get("path").and_then(Value::as_str) != Some(path_str.as_str()));
        let new_row =
            json!({ "path": path_str, "id": hash, "filename": name, "url": url, "mtime": mtime });
        rows.push(new_row.clone());
        adapter.set_table(files_location, rows).await;

        // Announced as `files` rather than `update`: the dashboard's CONTENT
        // is unchanged here, only its file table, and useDashboard's
        // handleDashboardUpdate bails on an identical content payload — so an
        // `update` would be silently dropped and the sprite list would stay
        // stale in every other window. A distinct operation name lets the
        // sprite refetch key off exactly this, without making every ordinary
        // dashboard save refetch sprites too.
        TypiQLBroker::publish(DashboardEntryChanged {
            operation_name: "files".to_string(),
            value: entry.clone(),
        });

        serde_json::from_value(new_row).map_err(|e| async_graphql::Error::new(e.to_string()))
    }

    /// Capture day/night preview thumbnails for a dashboard. Each of
    /// day_data/night_data is base64-encoded (optionally data-URL prefixed)
    /// PNG, or omitted to leave that slot untouched. Stored as files under
    /// the shared thumbnails cache dir (same one car thumbnails use, see
    /// car::thumbnails_dir), not per-dashboard — the content table only
    /// holds the generated filename, served from /thumbnails/*.
    async fn upload_dashboard_thumbnails(
        &self,
        ctx: &Context<'_>,
        id: String,
        day_data: Option<String>,
        night_data: Option<String>,
    ) -> GqlResult<crate::typiql_types::Dashboard> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let entry: DashboardEntry = adapter
            .get_one(Location::Named("dashboard_entries".to_string()), "id", &id)
            .await
            .ok_or_else(|| async_graphql::Error::new("Dashboard not found"))
            .and_then(|v| {
                serde_json::from_value(v).map_err(|e| async_graphql::Error::new(e.to_string()))
            })?;

        let content_location = Location::At {
            file: content_file(&entry.path),
            table: "dashboard".to_string(),
        };
        let mut content = adapter
            .get_many(content_location.clone(), vec![])
            .await
            .into_iter()
            .next()
            .unwrap_or_else(|| Value::Object(Default::default()));

        let dir = crate::graphql::car::thumbnails_dir();
        std::fs::create_dir_all(&dir).map_err(|e| async_graphql::Error::new(e.to_string()))?;

        let mut changed = false;
        if let Some(data) = day_data {
            let prev = content.get("thumbnail_day").and_then(Value::as_str);
            let filename = write_thumbnail_file(&dir, &id, "day", &data, prev)?;
            if let Value::Object(map) = &mut content {
                map.insert("thumbnail_day".to_string(), json!(filename));
            }
            changed = true;
        }
        if let Some(data) = night_data {
            let prev = content.get("thumbnail_night").and_then(Value::as_str);
            let filename = write_thumbnail_file(&dir, &id, "night", &data, prev)?;
            if let Value::Object(map) = &mut content {
                map.insert("thumbnail_night".to_string(), json!(filename));
            }
            changed = true;
        }

        if changed {
            adapter
                .set_table(content_location, vec![content.clone()])
                .await;
        }

        serde_json::from_value(content).map_err(|e| async_graphql::Error::new(e.to_string()))
    }

    async fn delete_dashboard_file(
        &self,
        ctx: &Context<'_>,
        dashboard_id: String,
        path: String,
    ) -> GqlResult<bool> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let entry: DashboardEntry = adapter
            .get_one(
                Location::Named("dashboard_entries".to_string()),
                "id",
                &dashboard_id,
            )
            .await
            .ok_or_else(|| async_graphql::Error::new("Dashboard not found"))
            .and_then(|v| {
                serde_json::from_value(v).map_err(|e| async_graphql::Error::new(e.to_string()))
            })?;

        let file_path = PathBuf::from(&path);
        if file_path.exists() {
            std::fs::remove_file(&file_path)
                .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        }

        let files_location = Location::At {
            file: content_file(&entry.path),
            table: "files".to_string(),
        };
        let mut rows = adapter.get_many(files_location.clone(), vec![]).await;
        rows.retain(|v| v.get("path").and_then(Value::as_str) != Some(path.as_str()));
        adapter.set_table(files_location, rows).await;

        // Announced as `files` rather than `update`: the dashboard's CONTENT
        // is unchanged here, only its file table, and useDashboard's
        // handleDashboardUpdate bails on an identical content payload — so an
        // `update` would be silently dropped and the sprite list would stay
        // stale in every other window. A distinct operation name lets the
        // sprite refetch key off exactly this, without making every ordinary
        // dashboard save refetch sprites too.
        TypiQLBroker::publish(DashboardEntryChanged {
            operation_name: "files".to_string(),
            value: entry.clone(),
        });

        Ok(true)
    }
}

/// Decodes base64 (optionally data-URL prefixed) image data, removes the
/// previous thumbnail file if present, and writes the new one under a fresh
/// unique filename (so /thumbnails/* can keep serving old requests with
/// long-lived caching without ever going stale).
fn write_thumbnail_file(
    dir: &Path,
    id: &str,
    tag: &str,
    data: &str,
    prev_filename: Option<&str>,
) -> GqlResult<String> {
    let b64 = match data.find(',') {
        Some(pos) => &data[pos + 1..],
        None => data,
    };
    use base64::prelude::*;
    let bytes = BASE64_STANDARD
        .decode(b64)
        .map_err(|e| async_graphql::Error::new(e.to_string()))?;

    if let Some(prev) = prev_filename {
        let prev_path = dir.join(prev);
        if prev_path.exists() {
            std::fs::remove_file(&prev_path).ok();
        }
    }

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let filename = format!("{}-{}-{}.png", id, tag, nanos);
    let file_path = dir.join(&filename);
    std::fs::write(&file_path, &bytes).map_err(|e| async_graphql::Error::new(e.to_string()))?;
    Ok(filename)
}

fn mock_sprites_dir() -> PathBuf {
    #[cfg(debug_assertions)]
    {
        PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../public/dash-sprites"
        ))
    }
    #[cfg(not(debug_assertions))]
    {
        PathBuf::from("dist/dash-sprites")
    }
}

/// A cheap `stat()`-only check (no content read) used to skip re-hashing a
/// file's full content when nothing about it has changed since the last sync.
fn file_mtime_secs(path: &Path) -> Option<i64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

/// Expand a leading `~` to the current user's home directory.
fn expand_tilde(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    } else if path == "~" {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home);
        }
    }
    PathBuf::from(path)
}

fn content_file(dash_path: &str) -> PathBuf {
    expand_tilde(dash_path).join(".dashboard.json")
}

/// Recursively list all non-hidden files under `current`, returning paths
/// relative to `base` with forward slashes.
fn walk_dir(base: &Path, current: &Path) -> Vec<String> {
    let mut result = Vec::new();
    let Ok(entries) = std::fs::read_dir(current) else {
        return result;
    };
    for entry in entries.flatten() {
        if entry
            .file_name()
            .to_str()
            .map(|s| s.starts_with('.'))
            .unwrap_or(false)
        {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            result.extend(walk_dir(base, &path));
        } else if let Ok(rel) = path.strip_prefix(base) {
            if let Some(s) = rel.to_str() {
                result.push(s.replace('\\', "/"));
            }
        }
    }
    result
}
