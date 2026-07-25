use regex::Regex;
use std::collections::HashMap;

/// One physical channel parsed out of a real Monocoque config, with every
/// effect block that shared its `pan` — mirrors the app's own ShakerChannel
/// and MonocoqueSoundDevice split (see typiql_types.rs), used only to seed
/// that storage from an existing hand-written config on first run (see
/// graphql::shaker_dsp::seed_from_monocoque_config_if_empty).
pub struct ParsedChannel {
    pub devid: String,
    pub channels: u8,
    pub position: Option<String>,
    pub effects: Vec<ParsedEffect>,
}

pub struct ParsedEffect {
    pub effect: String,
    pub volume: u8,
    pub modulation: String,
    pub frequency: Option<f32>,
    pub frequency_max: Option<f32>,
    pub amplitude: Option<f32>,
    pub amplitude_max: Option<f32>,
}

/// Parses every `device = "Sound"` block in a raw Monocoque config, grouped
/// by `pan` — the same join key the app's own ShakerChannel/
/// MonocoqueSoundDevice split uses, and the same grouping `buildChannels()`
/// already did client-side pre-ShakerChannel, so this reproduces exactly the
/// channel layout the app would already have shown for this file. Blocks
/// are otherwise independent of file order; channels come back in the order
/// their first block appeared.
pub fn parse_shaker_channels(text: &str) -> Vec<ParsedChannel> {
    let block_re = Regex::new(r"\{([^}]*)\}").unwrap();
    let mut by_pan: HashMap<u8, ParsedChannel> = HashMap::new();
    let mut order: Vec<u8> = Vec::new();

    for cap in block_re.captures_iter(text) {
        let block = &cap[1];

        if extract(block, "device") != "Sound" {
            continue;
        }

        let pan: u8 = extract(block, "pan").parse().unwrap_or(0);
        let devid = extract(block, "devid");
        let channels: u8 = extract(block, "channels").parse().unwrap_or(4);
        let tyre = extract_opt(block, "tyre");

        let entry = by_pan.entry(pan).or_insert_with(|| {
            order.push(pan);
            ParsedChannel {
                devid,
                channels,
                position: None,
                effects: Vec::new(),
            }
        });
        // First tyre value found for this pan wins — matches
        // buildChannels()'s pre-ShakerChannel "most common tyre" heuristic
        // closely enough (real configs are consistent per corner in
        // practice; there's no meaningful case where two tyre-effects on
        // the same physical channel disagree).
        if entry.position.is_none() && tyre.is_some() {
            entry.position = tyre;
        }

        entry.effects.push(ParsedEffect {
            effect: extract(block, "effect"),
            volume: extract(block, "volume").parse().unwrap_or(50),
            modulation: extract(block, "modulation"),
            frequency: extract_opt(block, "frequency").and_then(|v| v.parse().ok()),
            frequency_max: extract_opt(block, "frequencyMax").and_then(|v| v.parse().ok()),
            amplitude: extract_opt(block, "amplitude").and_then(|v| v.parse().ok()),
            amplitude_max: extract_opt(block, "amplitudeMax").and_then(|v| v.parse().ok()),
        });
    }

    order
        .into_iter()
        .filter_map(|pan| by_pan.remove(&pan))
        .collect()
}

fn extract(block: &str, key: &str) -> String {
    let re = Regex::new(&format!(r#"{} *= *"?(.*?)"?;"#, key)).unwrap();
    re.captures(block)
        .map(|c| c[1].to_string())
        .unwrap_or_default()
}

fn extract_opt(block: &str, key: &str) -> Option<String> {
    let re = Regex::new(&format!(r#"{} *= *"?(.*?)"?;"#, key)).unwrap();
    re.captures(block).map(|c| c[1].to_string())
}
