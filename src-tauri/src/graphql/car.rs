use crate::typiql_types::{Car, File};
use async_graphql::{Context, Object, Result as GqlResult};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use typiql::TypiQLAdapter;

/// Returns the directory where centralized 360° photos are stored.
/// Mirrors the `typiql_data_dir()` logic from `api.rs`.
pub fn car_photos_dir() -> PathBuf {
    let config = crate::config_manager::app_config::read_app_config().unwrap_or_default();
    let base = if let Some(dir) = config.settings.typiql_data_dir {
        if !dir.is_empty() {
            expand_tilde(&dir)
        } else {
            default_dir()
        }
    } else {
        default_dir()
    };
    base.join("360s")
}

fn default_dir() -> PathBuf {
    dirs::config_dir()
        .map(|p| p.join("dashboard-designer"))
        .unwrap_or_else(|| PathBuf::from("data/typiql"))
}

/// Where captured car-card thumbnails live. Unlike the 360° photos themselves
/// (user data, follows the configurable typiql_data_dir), thumbnails are a
/// disposable derived cache — default XDG cache location, not configurable.
/// The host's ~/.cache/dashboard-designer, not the sandbox's private one.
///
/// "Cache" undersells what lives here. Car thumbnails are captures the
/// frontend uploads as base64 -- there is no source on disk to regenerate them
/// from -- so a fresh directory is not a cold cache, it is data loss. Flatpak
/// redirects XDG_CACHE_HOME to ~/.var/app/<app-id>/cache, which left the
/// packaged build with 0 thumbnails against the 28 sitting in the host's cache,
/// and every car card broken. $HOME is not redirected, and the manifest's
/// --filesystem=xdg-cache/dashboard-designer:create grant makes the real
/// directory visible, so both builds share one cache exactly as they share one
/// config. Same reasoning as config_manager::monocoque_config_dir().
fn cache_root() -> Option<PathBuf> {
    if crate::host_command::in_flatpak() {
        if let Some(home) = dirs::home_dir() {
            return Some(home.join(".cache").join("dashboard-designer"));
        }
    }
    dirs::cache_dir().map(|p| p.join("dashboard-designer"))
}

pub fn thumbnails_dir() -> PathBuf {
    cache_root()
        .map(|p| p.join("thumbnails"))
        .unwrap_or_else(|| PathBuf::from("data/thumbnails"))
}

/// Per-file symlinks (named by content hash) that `/360-photos/*` actually
/// serves from — a derived cache, not primary user data, same rationale as
/// thumbnails_dir(). Each real 360 photo file (in car_photos_dir()) gets one
/// symlink here per distinct content it has ever had.
pub fn car_photo_links_dir() -> PathBuf {
    cache_root()
        .map(|p| p.join("car-photo-links"))
        .unwrap_or_else(|| PathBuf::from("data/car-photo-links"))
}

fn expand_tilde(s: &str) -> PathBuf {
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(s)
}

fn decode_b64(data: &str) -> GqlResult<Vec<u8>> {
    let b64 = match data.find(',') {
        Some(pos) => &data[pos + 1..],
        None => data,
    };
    use base64::prelude::*;
    BASE64_STANDARD
        .decode(b64)
        .map_err(|e| async_graphql::Error::new(e.to_string()))
}

fn ext_of(filename: &str) -> String {
    Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default()
}

/// Recreates the `/360-photos/*` symlinks from the File rows that already
/// exist, for links that are missing.
///
/// These links live in the cache directory, which is derived data and can be
/// thrown away -- except that nothing recreated them. They are written once,
/// when a photo is uploaded, so a cache that starts out empty stays empty and
/// every 360 photo 404s while thumbnails (regenerated on demand) load fine.
/// That is exactly what the Flatpak build hit: Flatpak redirects XDG_CACHE_HOME
/// to ~/.var/app/<app-id>/cache, so the sandbox had none of the ten links the
/// host's ~/.cache/dashboard-designer/car-photo-links held.
///
/// Runs at startup, is idempotent, and skips files that are already linked or
/// whose source has gone missing -- a photo that disappeared is not a reason to
/// refuse to start.
pub fn relink_existing_photos(data_dir: &Path) {
    let Ok(raw) = std::fs::read_to_string(data_dir.join("data.json")) else {
        return;
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let Some(files) = json.get("files").and_then(|f| f.as_array()) else {
        return;
    };

    let links_dir = car_photo_links_dir();
    if std::fs::create_dir_all(&links_dir).is_err() {
        return;
    }

    let mut relinked = 0usize;
    for file in files {
        let (Some(url), Some(path)) = (
            file.get("url").and_then(|u| u.as_str()),
            file.get("path").and_then(|p| p.as_str()),
        ) else {
            continue;
        };

        // The link name is the last segment of the URL this row already
        // advertises, so the rebuilt link answers exactly the request the
        // frontend will make.
        let Some(link_name) = url.rsplit('/').next().filter(|n| !n.is_empty()) else {
            continue;
        };
        let link_path = links_dir.join(link_name);
        if link_path.exists() || link_path.is_symlink() {
            continue;
        }

        let real_path = expand_tilde(path);
        if !real_path.is_file() {
            continue;
        }

        #[cfg(unix)]
        if std::os::unix::fs::symlink(&real_path, &link_path).is_ok() {
            relinked += 1;
        }
    }

    if relinked > 0 {
        eprintln!(
            "relink_existing_photos: restored {relinked} 360-photo link(s) in {}",
            links_dir.display()
        );
    }
}

/// Hashes `real_path`'s current bytes and ensures a symlink named
/// `{hash}{ext}` exists in car_photo_links_dir() pointing at it. Returns
/// `(content_hash, servable_url)` — the two File fields that change whenever
/// the underlying bytes change, independent of the File's stable `path` key.
fn hash_and_link(real_path: &Path, ext: &str) -> GqlResult<(String, String)> {
    let bytes = std::fs::read(real_path).map_err(|e| async_graphql::Error::new(e.to_string()))?;

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hash = format!("{:x}", hasher.finalize());

    let links_dir = car_photo_links_dir();
    std::fs::create_dir_all(&links_dir).map_err(|e| async_graphql::Error::new(e.to_string()))?;
    let link_name = format!("{hash}{ext}");
    let link_path = links_dir.join(&link_name);
    if link_path.is_symlink() || link_path.exists() {
        std::fs::remove_file(&link_path).ok();
    }
    #[cfg(unix)]
    std::os::unix::fs::symlink(real_path, &link_path)
        .map_err(|e| async_graphql::Error::new(e.to_string()))?;

    Ok((hash, format!("/360-photos/{link_name}")))
}

/// Upserts the File record keyed by `path` with the current hash/url/filename
/// — finds an existing row by path (an edit/replace, most common case after
/// first upload) and updates it in place, or creates one (first upload).
/// Whichever Car field points at this path (`day_photo_path`/
/// `night_photo_path`) never needs touching after it's first set — only this
/// File row's `id`/`url` change over time.
async fn upsert_file(
    adapter: &Arc<dyn TypiQLAdapter>,
    path: &str,
    filename: &str,
    id: &str,
    url: &str,
) -> GqlResult<()> {
    let values = json!({ "path": path, "id": id, "filename": filename, "url": url });
    if adapter
        .get_one("files".into(), "path", path)
        .await
        .is_some()
    {
        adapter.update("files".into(), "path", path, values).await;
    } else {
        adapter
            .add("files".into(), "path", values)
            .await
            .map_err(async_graphql::Error::new)?;
    }
    Ok(())
}

/// Writes a freshly-uploaded photo to its deterministic real-file location
/// (`{car_id}-{slot}{ext}`) and upserts the File record for that path. If
/// `previous_path` differs (the upload's extension changed from what was
/// there before), the old real file and its now-orphaned File record are
/// cleaned up. Returns the new deterministic path — the value to store
/// (once) on `Car.day_photo_path`/`night_photo_path`.
async fn store_uploaded_photo(
    adapter: &Arc<dyn TypiQLAdapter>,
    car_id: &str,
    slot: &str,
    filename: &str,
    data: &str,
    previous_path: Option<&String>,
) -> GqlResult<String> {
    let dir = car_photos_dir();
    std::fs::create_dir_all(&dir).map_err(|e| async_graphql::Error::new(e.to_string()))?;

    let ext = ext_of(filename);
    let real_path = dir.join(format!("{car_id}-{slot}{ext}"));
    let path_str = real_path.to_string_lossy().to_string();

    if let Some(prev_path) = previous_path {
        if prev_path != &path_str {
            let prev_pathbuf = PathBuf::from(prev_path);
            if prev_pathbuf.exists() {
                std::fs::remove_file(&prev_pathbuf).ok();
            }
            adapter.remove("files".into(), "path", prev_path).await;
        }
    }

    let bytes = decode_b64(data)?;
    std::fs::write(&real_path, &bytes).map_err(|e| async_graphql::Error::new(e.to_string()))?;

    let (hash, url) = hash_and_link(&real_path, &ext)?;
    upsert_file(adapter, &path_str, filename, &hash, &url).await?;

    Ok(path_str)
}

#[derive(Default)]
pub struct CarFileMutation;

#[Object]
impl CarFileMutation {
    /// Upload/replace a car's day 360° photo. Keyed by the Car's own `id` —
    /// the Car record itself must already exist (created via plain `addCar`).
    async fn upload_car_photo(
        &self,
        ctx: &Context<'_>,
        id: String,
        filename: String,
        data: String,
    ) -> GqlResult<Car> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let existing: Car = adapter
            .get_one("cars".into(), "id", &id)
            .await
            .ok_or_else(|| async_graphql::Error::new("Car not found"))
            .and_then(|v| {
                serde_json::from_value(v).map_err(|e| async_graphql::Error::new(e.to_string()))
            })?;

        let new_path = store_uploaded_photo(
            &adapter,
            &id,
            "day",
            &filename,
            &data,
            existing.day_photo_path.as_ref(),
        )
        .await?;

        let result_val = if existing.day_photo_path.as_deref() == Some(new_path.as_str()) {
            adapter
                .get_one("cars".into(), "id", &id)
                .await
                .ok_or_else(|| async_graphql::Error::new("Car not found"))?
        } else {
            adapter
                .update(
                    "cars".into(),
                    "id",
                    &id,
                    json!({ "day_photo_path": new_path }),
                )
                .await
                .ok_or_else(|| async_graphql::Error::new("Update failed"))?
        };

        serde_json::from_value(result_val).map_err(|e| async_graphql::Error::new(e.to_string()))
    }

    /// Upload the night variant of a car's 360° photo — same camera position,
    /// different lighting. Keyed by the Car's own `id`.
    async fn upload_car_photo_night(
        &self,
        ctx: &Context<'_>,
        id: String,
        filename: String,
        data: String,
    ) -> GqlResult<Car> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let existing: Car = adapter
            .get_one("cars".into(), "id", &id)
            .await
            .ok_or_else(|| async_graphql::Error::new("Car not found"))
            .and_then(|v| {
                serde_json::from_value(v).map_err(|e| async_graphql::Error::new(e.to_string()))
            })?;

        let new_path = store_uploaded_photo(
            &adapter,
            &id,
            "night",
            &filename,
            &data,
            existing.night_photo_path.as_ref(),
        )
        .await?;

        let result_val = if existing.night_photo_path.as_deref() == Some(new_path.as_str()) {
            adapter
                .get_one("cars".into(), "id", &id)
                .await
                .ok_or_else(|| async_graphql::Error::new("Car not found"))?
        } else {
            adapter
                .update(
                    "cars".into(),
                    "id",
                    &id,
                    json!({ "night_photo_path": new_path }),
                )
                .await
                .ok_or_else(|| async_graphql::Error::new("Update failed"))?
        };

        serde_json::from_value(result_val).map_err(|e| async_graphql::Error::new(e.to_string()))
    }

    /// Remove a car's night photo (file + File record), keeping the day photo intact.
    async fn delete_car_photo_night(&self, ctx: &Context<'_>, id: String) -> GqlResult<Car> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let existing: Car = adapter
            .get_one("cars".into(), "id", &id)
            .await
            .ok_or_else(|| async_graphql::Error::new("Car not found"))
            .and_then(|v| {
                serde_json::from_value(v).map_err(|e| async_graphql::Error::new(e.to_string()))
            })?;

        if let Some(path) = &existing.night_photo_path {
            let pathbuf = PathBuf::from(path);
            if pathbuf.exists() {
                std::fs::remove_file(&pathbuf)
                    .map_err(|e| async_graphql::Error::new(e.to_string()))?;
            }
            adapter.remove("files".into(), "path", path).await;
        }

        let result_val = adapter
            .update(
                "cars".into(),
                "id",
                &id,
                json!({ "night_photo_path": null }),
            )
            .await
            .ok_or_else(|| async_graphql::Error::new("Update failed"))?;

        serde_json::from_value(result_val).map_err(|e| async_graphql::Error::new(e.to_string()))
    }

    /// Capture a car-card thumbnail for this car's freelook viewer. `data` is
    /// base64-encoded (optionally data-URL prefixed) PNG. Stored as a file
    /// under thumbnails_dir(), not inline, to keep the JSON store small — the
    /// record only holds the generated filename, served from `/thumbnails/*`.
    /// Unaffected by the File-relation migration — thumbnail stays a plain field.
    async fn upload_car_thumbnail(
        &self,
        ctx: &Context<'_>,
        id: String,
        data: String,
    ) -> GqlResult<Car> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let existing_rec: Car = adapter
            .get_one("cars".into(), "id", &id)
            .await
            .ok_or_else(|| async_graphql::Error::new("Car not found"))
            .and_then(|v| {
                serde_json::from_value(v).map_err(|e| async_graphql::Error::new(e.to_string()))
            })?;

        let dir = thumbnails_dir();
        std::fs::create_dir_all(&dir).map_err(|e| async_graphql::Error::new(e.to_string()))?;

        let bytes = decode_b64(&data)?;

        // Replace any previous thumbnail file before writing the new one —
        // always a fresh filename so /thumbnails/* can be cached indefinitely.
        if let Some(prev) = &existing_rec.thumbnail {
            let prev_path = dir.join(prev);
            if prev_path.exists() {
                std::fs::remove_file(&prev_path).ok();
            }
        }

        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let filename = format!("{}-{}.png", existing_rec.id, nanos);

        let file_path = dir.join(&filename);
        std::fs::write(&file_path, &bytes).map_err(|e| async_graphql::Error::new(e.to_string()))?;

        let result_val = adapter
            .update(
                "cars".into(),
                "id",
                &existing_rec.id,
                json!({ "thumbnail": filename }),
            )
            .await
            .ok_or_else(|| async_graphql::Error::new("Update failed"))?;

        serde_json::from_value(result_val).map_err(|e| async_graphql::Error::new(e.to_string()))
    }

    /// Delete a car record and remove its file(s)/File record(s) from disk/store.
    async fn delete_car(&self, ctx: &Context<'_>, id: String) -> GqlResult<bool> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let rec: Car = adapter
            .get_one("cars".into(), "id", &id)
            .await
            .ok_or_else(|| async_graphql::Error::new("Car not found"))
            .and_then(|v| {
                serde_json::from_value(v).map_err(|e| async_graphql::Error::new(e.to_string()))
            })?;

        for path in [&rec.day_photo_path, &rec.night_photo_path]
            .into_iter()
            .flatten()
        {
            let pathbuf = PathBuf::from(path);
            if pathbuf.exists() {
                std::fs::remove_file(&pathbuf).ok();
            }
            adapter.remove("files".into(), "path", path).await;
        }
        if let Some(thumb_file) = &rec.thumbnail {
            let thumb_path = thumbnails_dir().join(thumb_file);
            if thumb_path.exists() {
                std::fs::remove_file(&thumb_path).ok();
            }
        }

        adapter.remove("cars".into(), "id", &id).await;
        Ok(true)
    }
}

#[derive(Default)]
pub struct CarPhotoSyncQuery;

#[Object]
impl CarPhotoSyncQuery {
    /// Recomputes the content-hash id for a car's day/night photos from
    /// whatever is currently on disk, refreshing the symlink and the File
    /// record's `id`/`url` if the file's content changed since the last sync
    /// — so replacing a photo file outside the app is picked up
    /// automatically, with no risk of a stale cached URL (the URL itself
    /// changes with the content). The Car row itself is never patched here —
    /// only the File row(s) it points at by (stable) path. Called by the
    /// frontend whenever a car's detail view loads.
    async fn sync_car_photos(&self, ctx: &Context<'_>, id: String) -> GqlResult<Car> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let existing: Car = adapter
            .get_one("cars".into(), "id", &id)
            .await
            .ok_or_else(|| async_graphql::Error::new("Car not found"))
            .and_then(|v| {
                serde_json::from_value(v).map_err(|e| async_graphql::Error::new(e.to_string()))
            })?;

        for path in [&existing.day_photo_path, &existing.night_photo_path]
            .into_iter()
            .flatten()
        {
            let pathbuf = PathBuf::from(path);
            if !pathbuf.exists() {
                continue;
            }
            let Some(file_val) = adapter.get_one("files".into(), "path", path).await else {
                continue;
            };
            let Ok(file_rec) = serde_json::from_value::<File>(file_val) else {
                continue;
            };
            let ext = ext_of(path);
            let Ok((new_hash, new_url)) = hash_and_link(&pathbuf, &ext) else {
                continue;
            };
            if new_hash != file_rec.id {
                upsert_file(&adapter, path, &file_rec.filename, &new_hash, &new_url).await?;
            }
        }

        Ok(existing)
    }
}
