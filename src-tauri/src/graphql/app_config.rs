use crate::config_manager::{
    app_config::{applications, read_app_config, write_app_config},
    to_gql_config, to_gql_entry,
    types::{AppConfig, AppSettings, AppSettingsInput, ChannelGamma, GamepadMapping, GqlAppConfig},
};
use crate::huenicorn::HuenicornSettingsChanged;
use async_graphql::{Context, MaybeUndefined, Object, Result as GqlResult};
use typiql::TypiQLBroker;

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
                huenicorn_enabled: merge_required(
                    s.huenicorn_enabled,
                    existing.settings.huenicorn_enabled,
                ),
                ambient_tint_intensity: merge_required(
                    s.ambient_tint_intensity,
                    existing.settings.ambient_tint_intensity,
                ),
                ambient_primary_channel: merge_optional(
                    s.ambient_primary_channel,
                    existing.settings.ambient_primary_channel,
                ),
                ambient_saturation_boost_day: merge_required(
                    s.ambient_saturation_boost_day,
                    existing.settings.ambient_saturation_boost_day,
                ),
                ambient_saturation_boost_night: merge_required(
                    s.ambient_saturation_boost_night,
                    existing.settings.ambient_saturation_boost_night,
                ),
                ambient_channel_gamma: match s.ambient_channel_gamma {
                    MaybeUndefined::Undefined => existing.settings.ambient_channel_gamma,
                    MaybeUndefined::Null => None,
                    MaybeUndefined::Value(gs) => Some(
                        gs.into_iter()
                            .map(|g| ChannelGamma {
                                channel_id: g.channel_id,
                                day: g.day,
                                night: g.night,
                            })
                            .collect(),
                    ),
                },
                simd_command: merge_required(s.simd_command, existing.settings.simd_command),
                monocoque_command: merge_required(
                    s.monocoque_command,
                    existing.settings.monocoque_command,
                ),
                huenicorn_command: merge_required(
                    s.huenicorn_command,
                    existing.settings.huenicorn_command,
                ),
            }
        } else {
            existing.settings
        };

        let app_config = AppConfig {
            settings: new_settings,
        };
        write_app_config(&app_config).map_err(async_graphql::Error::new)?;

        TypiQLBroker::publish(HuenicornSettingsChanged {
            huenicorn_enabled: app_config.settings.huenicorn_enabled,
            ambient_tint_intensity: app_config.settings.ambient_tint_intensity,
            ambient_primary_channel: app_config.settings.ambient_primary_channel,
            ambient_saturation_boost_day: app_config.settings.ambient_saturation_boost_day,
            ambient_saturation_boost_night: app_config.settings.ambient_saturation_boost_night,
        });

        let mut gql = to_gql_config(app_config);
        gql.applications = applications().into_iter().map(to_gql_entry).collect();
        Ok(gql)
    }
}
