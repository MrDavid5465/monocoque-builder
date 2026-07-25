use crate::typiql_types::{
    Dashboard, DashboardEntry, DashboardEntryChanged, DashboardEntryInput, DashboardInput,
};
use async_graphql::{Context, Object, Result as GqlResult};
use serde_json::Value;
use std::path::PathBuf;
use typiql::{resolve_add, Location, TypiQLBroker};

/// Expand a leading `~` to the current user's home directory. Duplicated
/// privately per-module elsewhere in this codebase (car.rs, dashboard_files.rs,
/// api.rs) — matching that existing convention rather than introducing a
/// shared helper module.
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

fn strip_nulls(v: Value) -> Value {
    match v {
        Value::Object(map) => {
            Value::Object(map.into_iter().filter(|(_, v)| !v.is_null()).collect())
        }
        other => other,
    }
}

/// Shallow merge: `patch`'s keys overwrite `base`'s, everything else in
/// `base` is kept as-is — the same "omit a field to leave it untouched"
/// convention every other update mutation in this app already relies on.
fn merge_objects(base: Value, patch: Value) -> Value {
    match (base, patch) {
        (Value::Object(mut base_map), Value::Object(patch_map)) => {
            for (k, v) in patch_map {
                base_map.insert(k, v);
            }
            Value::Object(base_map)
        }
        (_, patch) => patch,
    }
}

#[derive(Default)]
pub struct DashboardMutation;

#[Object]
impl DashboardMutation {
    /// Creates a dashboard: the location row (id/name/path) via the normal
    /// auto-generated add path, plus its initial content file — one call,
    /// matching what the frontend's "create dashboard" flow expects (a
    /// single mutation that produces a fully working dashboard).
    async fn add_dashboard(
        &self,
        ctx: &Context<'_>,
        entry: DashboardEntryInput,
        content: DashboardInput,
    ) -> GqlResult<DashboardEntry> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let created_entry = resolve_add::<DashboardEntry>(ctx, entry).await?;
        TypiQLBroker::publish(DashboardEntryChanged {
            operation_name: "add".to_string(),
            value: created_entry.clone(),
        });

        let content_value =
            serde_json::to_value(&content).map_err(|e| async_graphql::Error::new(e.to_string()))?;
        let content_value = strip_nulls(content_value);
        adapter
            .set_table(
                Location::At {
                    file: content_file(&created_entry.path),
                    table: "dashboard".to_string(),
                },
                vec![content_value],
            )
            .await;

        Ok(created_entry)
    }

    /// Updates a dashboard's content (canvas, elements, kiosk settings,
    /// thumbnails). Reads the entry (for its `path`), merges the patch onto
    /// the *existing* content, writes back. `id` here is the DashboardEntry's
    /// own id. `DashboardInput`'s fields are `MaybeUndefined<T>` — an omitted
    /// field leaves the existing value untouched, an explicit `null` clears
    /// it, matching every other update mutation in this app (see
    /// typiql-core's `resolve_update`, which this hand-written mutation
    /// mirrors since `Dashboard` is a `no_location` type with no default
    /// storage of its own to run resolve_update against directly). No
    /// strip_nulls here (unlike add_dashboard below) — the serialized patch
    /// is already exactly correct: omitted fields are fully absent as keys
    /// (via #[serde(skip_serializing_if)] on the generated Input struct),
    /// explicit-null fields are present as JSON null.
    async fn update_dashboard(
        &self,
        ctx: &Context<'_>,
        id: String,
        update: DashboardInput,
    ) -> GqlResult<Option<Dashboard>> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let Some(entry_val) = adapter
            .get_one(Location::Named("dashboard_entries".to_string()), "id", &id)
            .await
        else {
            return Ok(None);
        };
        let entry: DashboardEntry = serde_json::from_value(entry_val)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;

        let file = content_file(&entry.path);
        let existing = adapter
            .get_many(
                Location::At {
                    file: file.clone(),
                    table: "dashboard".to_string(),
                },
                vec![],
            )
            .await
            .into_iter()
            .next()
            .unwrap_or_else(|| Value::Object(Default::default()));

        let patch =
            serde_json::to_value(&update).map_err(|e| async_graphql::Error::new(e.to_string()))?;
        let merged = merge_objects(existing, patch);

        adapter
            .set_table(
                Location::At {
                    file,
                    table: "dashboard".to_string(),
                },
                vec![merged.clone()],
            )
            .await;

        TypiQLBroker::publish(DashboardEntryChanged {
            operation_name: "update".to_string(),
            value: entry,
        });

        let dashboard: Dashboard =
            serde_json::from_value(merged).map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(Some(dashboard))
    }
}
