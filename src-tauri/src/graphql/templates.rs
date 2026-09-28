use super::car::thumbnails_dir;
use crate::typiql_types::{DashTemplate, DashTemplateChanged};
use async_graphql::{Context, Object, Result as GqlResult};
use serde_json::json;
use typiql::TypiQLBroker;

#[derive(Default)]
pub struct DashTemplateThumbnailMutation;

#[Object]
impl DashTemplateThumbnailMutation {
    /// Capture a thumbnail for this template's component tree. `data` is
    /// base64-encoded (optionally data-URL prefixed) PNG. Stored as a file
    /// under thumbnails_dir(), same convention as Car/Dashboard thumbnails —
    /// not a live-rendered preview, which was explicitly rejected as
    /// non-performant for a template list/card view.
    async fn upload_dash_template_thumbnail(
        &self,
        ctx: &Context<'_>,
        id: String,
        data: String,
    ) -> GqlResult<DashTemplate> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let existing: DashTemplate = adapter
            .get_one("dash_templates".into(), "id", &id)
            .await
            .ok_or_else(|| async_graphql::Error::new("Template not found"))
            .and_then(|v| {
                serde_json::from_value(v).map_err(|e| async_graphql::Error::new(e.to_string()))
            })?;

        let dir = thumbnails_dir();
        std::fs::create_dir_all(&dir).map_err(|e| async_graphql::Error::new(e.to_string()))?;

        let b64 = match data.find(',') {
            Some(pos) => &data[pos + 1..],
            None => &data,
        };
        use base64::prelude::*;
        let bytes = BASE64_STANDARD
            .decode(b64)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;

        // Replace any previous thumbnail file before writing the new one —
        // always a fresh filename so /thumbnails/* can be cached indefinitely.
        if let Some(prev) = &existing.thumbnail {
            let prev_path = dir.join(prev);
            if prev_path.exists() {
                std::fs::remove_file(&prev_path).ok();
            }
        }

        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let filename = format!("{}-{}.png", existing.id, nanos);

        let file_path = dir.join(&filename);
        std::fs::write(&file_path, &bytes).map_err(|e| async_graphql::Error::new(e.to_string()))?;

        let result_val = adapter
            .update(
                "dash_templates".into(),
                "id",
                &existing.id,
                json!({ "thumbnail": filename }),
            )
            .await
            .ok_or_else(|| async_graphql::Error::new("Update failed"))?;

        let updated: DashTemplate = serde_json::from_value(result_val)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        // Written through the adapter, which bypasses the macro's own
        // announcement, so this has to publish by hand. `DashTemplateChanged`
        // is already carried by the shared dashboardUpdates subscription —
        // only the publish was missing, so a newly captured thumbnail didn't
        // appear in a template list open anywhere else.
        TypiQLBroker::publish(DashTemplateChanged {
            operation_name: "update".to_string(),
            value: updated.clone(),
        });
        Ok(updated)
    }
}
