use async_graphql::{Context, Object, Result as GqlResult, SimpleObject};

const BUILTIN_TEMPLATES_JSON: &str = include_str!("../../data/builtin_templates.json");

#[derive(SimpleObject)]
pub struct GqlBuiltinTemplate {
    pub id: String,
    pub name: String,
    pub gauge_type: String,
    pub component: String,
}

#[derive(Default)]
pub struct BuiltinTemplatesQuery;

#[Object]
impl BuiltinTemplatesQuery {
    async fn get_builtin_templates(
        &self,
        _ctx: &Context<'_>,
    ) -> GqlResult<Vec<GqlBuiltinTemplate>> {
        let raw: Vec<serde_json::Value> = serde_json::from_str(BUILTIN_TEMPLATES_JSON)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        Ok(raw
            .into_iter()
            .filter_map(|v| {
                Some(GqlBuiltinTemplate {
                    id: v["id"].as_str()?.to_string(),
                    name: v["name"].as_str()?.to_string(),
                    gauge_type: v["gauge_type"].as_str()?.to_string(),
                    component: v["component"].as_str()?.to_string(),
                })
            })
            .collect())
    }
}
