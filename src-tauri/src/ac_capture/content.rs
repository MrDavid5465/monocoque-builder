//! Reading which cars are actually installed in Assetto Corsa.
//!
//! Until now the only cars TyPiQL knew about were ones it had seen in
//! telemetry — you had to drive something before you could configure it.
//! The capture feature needs the opposite: a list of everything installed,
//! so a car can be chosen and photographed without having driven it first.

use std::path::Path;

/// One car installed in the game.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcCar {
    /// Folder name under `content/cars`, which is also the id AC uses
    /// everywhere else — in `race.ini`, and in the telemetry this app
    /// already stores as `Car.car_ids`.
    pub id: String,
    /// Display name from `ui/ui_car.json`, falling back to the folder name.
    pub name: String,
    pub brand: Option<String>,
}

/// Lists installed cars, sorted by display name.
///
/// Folders beginning with `.` are skipped, as is anything without a
/// `data.acd`/`data` directory — mod folders sometimes leave behind partial
/// or disabled content that the game itself won't load either.
pub fn installed_cars(install_dir: &Path) -> Vec<AcCar> {
    let cars_dir = install_dir.join("content/cars");
    let Ok(entries) = std::fs::read_dir(&cars_dir) else {
        return Vec::new();
    };

    let mut cars: Vec<AcCar> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let id = entry.file_name().to_string_lossy().into_owned();
            if id.starts_with('.') {
                return None;
            }
            let path = entry.path();
            if !path.join("data.acd").exists() && !path.join("data").is_dir() {
                return None;
            }
            let (name, brand) = read_ui_car(&path).unwrap_or((id.clone(), None));
            Some(AcCar { id, name, brand })
        })
        .collect();

    cars.sort_by_key(|a| a.name.to_lowercase());
    cars
}

/// Pulls `name` and `brand` out of `ui/ui_car.json`.
///
/// Parsed leniently on purpose. These files are authored by hundreds of
/// different mod makers and a good number are not valid JSON — unescaped
/// newlines inside descriptions are common — so a strict parse would drop
/// otherwise perfectly usable cars. A failed parse just means the folder
/// name gets used as the display name.
fn read_ui_car(car_dir: &Path) -> Option<(String, Option<String>)> {
    let raw = std::fs::read_to_string(car_dir.join("ui/ui_car.json")).ok()?;
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(value) => {
            let name = value.get("name")?.as_str()?.trim().to_string();
            let brand = value
                .get("brand")
                .and_then(|b| b.as_str())
                .map(|b| b.trim().to_string())
                .filter(|b| !b.is_empty());
            (!name.is_empty()).then_some((name, brand))
        }
        // Falls back to scraping the one field that matters rather than
        // giving up on a malformed file.
        Err(_) => extract_field(&raw, "name").map(|name| (name, extract_field(&raw, "brand"))),
    }
}

/// Finds `"key": "value"` in text that isn't necessarily valid JSON.
fn extract_field(raw: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let start = raw.find(&needle)? + needle.len();
    let rest = &raw[start..];
    let colon = rest.find(':')? + 1;
    let rest = &rest[colon..];
    let open = rest.find('"')? + 1;
    let rest = &rest[open..];
    let end = rest.find('"')?;
    let value = rest[..end].trim().to_string();
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn car_dir(root: &Path, id: &str, ui: Option<&str>) -> std::path::PathBuf {
        let dir = root.join("content/cars").join(id);
        std::fs::create_dir_all(dir.join("ui")).unwrap();
        std::fs::write(dir.join("data.acd"), b"").unwrap();
        if let Some(ui_json) = ui {
            std::fs::write(dir.join("ui/ui_car.json"), ui_json).unwrap();
        }
        dir
    }

    fn temp_root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("typiql-cars-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn reads_names_and_sorts_them() {
        let root = temp_root();
        car_dir(&root, "zzz_car", Some(r#"{"name":"Alpha","brand":"Acme"}"#));
        car_dir(
            &root,
            "aaa_car",
            Some(r#"{"name":"Zeta","brand":"Zenith"}"#),
        );

        let cars = installed_cars(&root);

        assert_eq!(cars.len(), 2);
        assert_eq!(cars[0].name, "Alpha");
        assert_eq!(cars[0].id, "zzz_car");
        assert_eq!(cars[0].brand.as_deref(), Some("Acme"));
        assert_eq!(cars[1].name, "Zeta");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn falls_back_to_the_folder_name_without_metadata() {
        let root = temp_root();
        car_dir(&root, "no_ui_car", None);

        let cars = installed_cars(&root);

        assert_eq!(cars.len(), 1);
        assert_eq!(cars[0].name, "no_ui_car");
        assert_eq!(cars[0].brand, None);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn recovers_a_name_from_malformed_json() {
        let root = temp_root();
        // Unescaped newline inside a string — invalid JSON, and common in
        // real mod content.
        car_dir(
            &root,
            "broken",
            Some("{\n\"name\": \"Broken Car\",\n\"description\": \"line\nbreak\"\n}"),
        );

        let cars = installed_cars(&root);

        assert_eq!(cars.len(), 1);
        assert_eq!(cars[0].name, "Broken Car");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn skips_folders_without_car_data() {
        let root = temp_root();
        std::fs::create_dir_all(root.join("content/cars/not_a_car")).unwrap();
        car_dir(&root, "real_car", Some(r#"{"name":"Real"}"#));

        let cars = installed_cars(&root);

        assert_eq!(cars.len(), 1);
        assert_eq!(cars[0].id, "real_car");
        std::fs::remove_dir_all(&root).ok();
    }
}
