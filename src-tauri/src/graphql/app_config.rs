use crate::config_manager::{
    app_config::{applications, read_app_config, write_app_config},
    to_gql_config, to_gql_entry,
    types::{AppConfig, AppSettings, AppSettingsInput, GamepadMapping, GqlAppConfig},
};
use async_graphql::{Context, MaybeUndefined, Object, Result as GqlResult};

/// For fields backed by an `Option<T>` on `AppSettings` — Undefined keeps
/// the existing value, Null clears it to None, Value sets it.
fn merge_optional<T>(input: MaybeUndefined<T>, existing: Option<T>) -> Option<T> {
    match input {
        MaybeUndefined::Undefined => existing,
        MaybeUndefined::Null => None,
        MaybeUndefined::Value(v) => Some(v),
    }
}

/// For fields backed by a non-`Option` (required) `AppSettings` field —
/// Undefined keeps the existing value; Null is treated the same as
/// Undefined (a pragmatic no-op — there's no way to statically stop a
/// client sending null for a field that doesn't semantically support
/// clearing); Value sets it.
fn merge_required<T>(input: MaybeUndefined<T>, existing: T) -> T {
    match input {
        MaybeUndefined::Value(v) => v,
        MaybeUndefined::Undefined | MaybeUndefined::Null => existing,
    }
}

#[derive(Default)]
pub struct AppConfigQuery;

#[Object]
impl AppConfigQuery {
    async fn my(&self, _ctx: &Context<'_>) -> GqlResult<GqlAppConfig> {
        let config = read_app_config().map_err(async_graphql::Error::new)?;
        let mut gql = to_gql_config(config);
        gql.applications = applications().into_iter().map(to_gql_entry).collect();
        Ok(gql)
    }
}

#[derive(Default)]
pub struct AppConfigMutation;

#[Object]
impl AppConfigMutation {
    async fn update_settings(
        &self,
        _ctx: &Context<'_>,
        settings: Option<AppSettingsInput>,
    ) -> GqlResult<GqlAppConfig> {
        let existing = read_app_config().map_err(async_graphql::Error::new)?;

        let new_settings = if let Some(s) = settings {
            AppSettings {
                theme: merge_required(s.theme, existing.settings.theme),
                font_size: merge_required(s.font_size, existing.settings.font_size),
                launch_page: merge_required(s.launch_page, existing.settings.launch_page),
                device_map: merge_optional(s.device_map, existing.settings.device_map),
                typiql_data_dir: merge_optional(
                    s.typiql_data_dir,
                    existing.settings.typiql_data_dir,
                ),
                steer_max_deg: merge_optional(s.steer_max_deg, existing.settings.steer_max_deg),
                setup_complete: merge_required(s.setup_complete, existing.settings.setup_complete),
                gamepad_mappings: match s.gamepad_mappings {
                    MaybeUndefined::Undefined => existing.settings.gamepad_mappings,
                    MaybeUndefined::Null => None,
                    MaybeUndefined::Value(ms) => Some(
                        ms.into_iter()
                            .map(|m| GamepadMapping {
                                id: m.id,
                                name: m.name,
                                mapping_type: m.mapping_type,
                                index: m.index,
                            })
                            .collect(),
                    ),
                },
                shaker_dsp_enabled: merge_required(
                    s.shaker_dsp_enabled,
                    existing.settings.shaker_dsp_enabled,
                ),
                shaker_lfe_source_device: merge_optional(
                    s.shaker_lfe_source_device,
                    existing.settings.shaker_lfe_source_device,
                ),
                shaker_lfe_lpf_hz: merge_optional(
                    s.shaker_lfe_lpf_hz,
                    existing.settings.shaker_lfe_lpf_hz,
                ),
            }
        } else {
            existing.settings
        };

        let app_config = AppConfig {
            settings: new_settings,
        };
        write_app_config(&app_config).map_err(async_graphql::Error::new)?;

        let mut gql = to_gql_config(app_config);
        gql.applications = applications().into_iter().map(to_gql_entry).collect();
        Ok(gql)
    }
}
