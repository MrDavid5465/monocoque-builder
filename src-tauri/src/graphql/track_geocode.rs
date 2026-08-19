use async_graphql::{Object, Result as GqlResult, SimpleObject};
use serde::Deserialize;

#[derive(SimpleObject)]
pub struct GeocodeResult {
    pub display_name: String,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Deserialize)]
struct NominatimResult {
    display_name: String,
    lat: String,
    lon: String,
}

#[derive(Default)]
pub struct TrackGeocodeQuery;

#[Object]
impl TrackGeocodeQuery {
    /// Free-text geocode search for filling in a TrackLocation's
    /// latitude/longitude without a paid mapping API — search e.g.
    /// "Silverstone Circuit UK" and pick the right result. Backed by
    /// OpenStreetMap's Nominatim, proxied through this resolver (rather than
    /// called directly from the browser) so it can set a real User-Agent per
    /// Nominatim's usage policy
    /// (https://operations.osmfoundation.org/policies/nominatim/) instead of
    /// whatever the browser would send, and to sidestep any CORS friction.
    /// Nominatim's free tier asks for roughly one request per second — fine
    /// for an admin "type a name, click search" flow, not for bulk/automated
    /// lookups.
    async fn search_track_locations(&self, query: String) -> GqlResult<Vec<GeocodeResult>> {
        if query.trim().is_empty() {
            return Ok(vec![]);
        }
        let client = reqwest::Client::new();
        let resp = client
            .get("https://nominatim.openstreetmap.org/search")
            .query(&[("q", query.as_str()), ("format", "json"), ("limit", "5")])
            .header(
                "User-Agent",
                "typiql-tauri-dashboard-designer/1.0 (local sim-rig admin tool, track location lookup)",
            )
            .send()
            .await
            .map_err(|e| async_graphql::Error::new(format!("geocode search failed: {e}")))?;
        let results: Vec<NominatimResult> = resp.json().await.map_err(|e| {
            async_graphql::Error::new(format!("geocode search returned unexpected data: {e}"))
        })?;
        Ok(results
            .into_iter()
            .filter_map(|r| {
                Some(GeocodeResult {
                    display_name: r.display_name,
                    latitude: r.lat.parse().ok()?,
                    longitude: r.lon.parse().ok()?,
                })
            })
            .collect())
    }
}
