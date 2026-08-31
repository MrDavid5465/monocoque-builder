# Changelog

## [0.5.0](https://github.com/MrDavid5465/telemetry-admin/compare/telemetry-admin-v0.4.0...telemetry-admin-v0.5.0) (2026-08-31)


### Features

* **360-viewer:** paint the ambient tint above the night overlay ([c526685](https://github.com/MrDavid5465/telemetry-admin/commit/c526685375392a8813719c8223a02ae6ffa8586f))
* **ambient-lights:** gate settings behind a Huenicorn-installed check ([02d1121](https://github.com/MrDavid5465/telemetry-admin/commit/02d1121cf3c41a8bac8da4acba6e99c4945fa1cc))
* **ambient-lights:** soft-light 360 blend, channel mapping, screen reselect ([92c20ba](https://github.com/MrDavid5465/telemetry-admin/commit/92c20ba509f0d73397101f46ba3d0e22a22b8296))
* **ambient-lights:** split saturation boost into day/night values ([42e87fc](https://github.com/MrDavid5465/telemetry-admin/commit/42e87fc6971609c9c16b4ea31cda526edf687e72))
* **per-form:** first-class `list` field for repeating rows ([62b94e3](https://github.com/MrDavid5465/telemetry-admin/commit/62b94e347a4bab49e468e07af352d5590d44ee97))
* **per-form:** migrate hand-rolled repeating rows to the `list` field ([7e9608a](https://github.com/MrDavid5465/telemetry-admin/commit/7e9608adb4e232b4a03445b72a1d8b6aa814c444))
* **services:** configurable service commands, liveness checks, restart backoff ([91d7243](https://github.com/MrDavid5465/telemetry-admin/commit/91d72431de1b12183798da6759125c27ca0b5a7f))
* **tracks:** select track ids from telemetry instead of typing them ([c742c7c](https://github.com/MrDavid5465/telemetry-admin/commit/c742c7c5193dbbd474d58d2df2b7307205830812))
* **typical-admin:** per-row delete in the table view, single Add button ([692d8ed](https://github.com/MrDavid5465/telemetry-admin/commit/692d8eddca9f218c1b84e2ba2a9d2977f6607dd7))


### Bug Fixes

* **360-viewer:** darken the scene at night even when the car has a night photo ([6c195e9](https://github.com/MrDavid5465/telemetry-admin/commit/6c195e963beac0ca6a269f0ebbe7d2c7d06e9fad))
* **360-viewer:** drop the rolling-baseline gate that faded the ambient tint out ([cda0b3c](https://github.com/MrDavid5465/telemetry-admin/commit/cda0b3cc1a8ac30d0d7ac5e590968d99b70e6c9e))
* **360-viewer:** move night darkening into the shader so the tint survives it ([de0aeba](https://github.com/MrDavid5465/telemetry-admin/commit/de0aeba72eb92a2ea82302db247b3c472e020c73))
* **360-viewer:** restore the night overlay for cars without a night photo ([113e033](https://github.com/MrDavid5465/telemetry-admin/commit/113e0337306cd11426ae0bdab2f32397fdcb4deb))
* **cargo:** sync the stale version in Cargo.lock ([7807f1b](https://github.com/MrDavid5465/telemetry-admin/commit/7807f1bfa17740b0f951ec88116ce63900075db6))
* **design-sync:** silence the unused car fixture in two previews ([5855d39](https://github.com/MrDavid5465/telemetry-admin/commit/5855d397cff7977f807707a53e217e0586b0380b))
* **gamepad:** report udev status by capability, not by artifact ([8a6e307](https://github.com/MrDavid5465/telemetry-admin/commit/8a6e307921d6167e5f121ef6a1b9e29be3368555))

## [0.4.0](https://github.com/MrDavid5465/telemetry-admin/compare/telemetry-admin-v0.3.0...telemetry-admin-v0.4.0) (2026-08-24)


### Features

* **dashboard-designer:** add clock-text and clock-sprite components ([654529f](https://github.com/MrDavid5465/telemetry-admin/commit/654529f12e190dee58d1529dc1adb0621faf6653))
* **shakers:** wire device config export to monocoque; add Moza shift-light + device pickers ([d17dd98](https://github.com/MrDavid5465/telemetry-admin/commit/d17dd982a1a22db2f8f92238910195ab3ba27712))
* **telemetry-admin:** add track locations with sunrise/sunset computation ([47bf76c](https://github.com/MrDavid5465/telemetry-admin/commit/47bf76c65584013b24815c62a452bab31a6a6e80))
* **telemetry-admin:** server-authoritative simulated day/night clock ([85287a5](https://github.com/MrDavid5465/telemetry-admin/commit/85287a5a98b611b9234c7d12f9283d0fd79c4ec6))
* **typiql:** backend support for day/night clock, track locations, and Moza shift-light devices ([4560fde](https://github.com/MrDavid5465/telemetry-admin/commit/4560fdee48006ca629718cf56bfd9b5e5faaf14a))


### Bug Fixes

* **dashboard-designer:** eliminate render-depth crash, add backend-restart auto-recovery ([879c125](https://github.com/MrDavid5465/telemetry-admin/commit/879c1253f955ef919ed64ea3737dd45170834146))
* **dashboard-designer:** merge live-update subscriptions into one hub, fix render-loop instability ([ebe3c44](https://github.com/MrDavid5465/telemetry-admin/commit/ebe3c44318a3e9c57aab35a23833655178bdd1c1))
* **dashboard-designer:** show canvas edge in edit mode, retry flaky thumbnail capture ([929c249](https://github.com/MrDavid5465/telemetry-admin/commit/929c249200fb4946f78a69aa5789542ef2b4c85e))
* **dashboard-designer:** single WebGL context for 360 viewer day/night blend ([8c71545](https://github.com/MrDavid5465/telemetry-admin/commit/8c71545cf0b2276adf9315999cbaf17d19f4f20d))
* **dashboards:** stop cropping dashboard thumbnails in the list view ([2480643](https://github.com/MrDavid5465/telemetry-admin/commit/2480643f6805be0f0a7b7cf6ae383536ccf393d0))
* **per-form:** timetoday field's dropdowns open downward instead of sideways ([3992dcf](https://github.com/MrDavid5465/telemetry-admin/commit/3992dcf9b5bd67be2f4d038b63bf0ada71141064))

## [0.3.0](https://github.com/MrDavid5465/telemetry-admin/compare/telemetry-admin-v0.2.0...telemetry-admin-v0.3.0) (2026-08-11)


### Features

* **dashboard-designer:** add sprite crop tool, fix kiosk pan/zoom lockout, live per-car 360 pan sync ([3f7a327](https://github.com/MrDavid5465/telemetry-admin/commit/3f7a327880b3dbe2731070e816be927d2d7c709a))
* **dashboard-designer:** add transform-sprite component + limit-behavior on telemetry bindings ([218506c](https://github.com/MrDavid5465/telemetry-admin/commit/218506ce59fc8036972639b9f946d0b6da4cb13c))
* **skills:** add completing-prs skill ([1b9e5d4](https://github.com/MrDavid5465/telemetry-admin/commit/1b9e5d47c00f17bcd804f331339e931b53cdb869))
* **skills:** add form-schema skill with static schema validator ([dbdfd1c](https://github.com/MrDavid5465/telemetry-admin/commit/dbdfd1c5c855ce6230569e731ca07cf1531d29a1))
* **skills:** add list-schema skill ([8d64721](https://github.com/MrDavid5465/telemetry-admin/commit/8d64721950150bcd01644825aad7702c560dd2fb))
* **skills:** add reactive-admin skill ([e488517](https://github.com/MrDavid5465/telemetry-admin/commit/e488517a37a2f4dedc329c31618e3144fb5ed826))
* **skills:** add validate-list-schema.cjs to list-schema ([bac9150](https://github.com/MrDavid5465/telemetry-admin/commit/bac9150d805b163db26f3174fd49ff85a9b89d05))


### Bug Fixes

* **dashboard-designer:** fix no-useless-assignment lint error in TransformOverlay ([0bfd52d](https://github.com/MrDavid5465/telemetry-admin/commit/0bfd52d98abc6551e70a826afbe32bd4090c538a))
* **skills:** clarify reactive-admin only needs overrides passed ([2f8b2da](https://github.com/MrDavid5465/telemetry-admin/commit/2f8b2dac4be69d9a814894811a1e8ed399813318))

## [0.2.0](https://github.com/MrDavid5465/telemetry-admin/compare/telemetry-admin-v0.1.2...telemetry-admin-v0.2.0) (2026-07-29)


### Features

* **dashboard-designer:** rework telemetry binding UI, fix startup sweep, bundle template sprites ([9eb916d](https://github.com/MrDavid5465/telemetry-admin/commit/9eb916d1fc169e0a2240e1cd5508e4eaa014fde9))

## [0.1.2](https://github.com/MrDavid5465/telemetry-admin/compare/telemetry-admin-v0.1.1...telemetry-admin-v0.1.2) (2026-07-27)


### Code Refactoring

* standardize hand-rolled UI on Fluent components and per-form ([954b1d0](https://github.com/MrDavid5465/telemetry-admin/commit/954b1d020683b20726cdfd330e8b44d5a4c92cd2))


### Bug Fixes

* **ci:** publish-aur download URL used wrong release tag format ([f450247](https://github.com/MrDavid5465/telemetry-admin/commit/f450247d5bca1c300145b5afd78e4f78be6ea7c4))
* **ci:** publish-aur GIT_SSH_COMMAND instead of relying on ~/.ssh/config ([f365600](https://github.com/MrDavid5465/telemetry-admin/commit/f365600dee1372ef37d441471aee91a15a8656ff))
* **ci:** stop creating draft GitHub Releases ([8b3092f](https://github.com/MrDavid5465/telemetry-admin/commit/8b3092f8b22445281327083453230bd93eccf7a7))
* **ci:** use StrictHostKeyChecking=accept-new for AUR push instead of ssh-keyscan ([dca32d4](https://github.com/MrDavid5465/telemetry-admin/commit/dca32d43c2f375c452a7354d15a8e252e77c4dc2))

## [0.1.1](https://github.com/MrDavid5465/telemetry-admin/compare/telemetry-admin-v0.1.0...telemetry-admin-v0.1.1) (2026-07-26)


### Bug Fixes

* **e2e:** repair gauge-setup suite for current app shape ([a248509](https://github.com/MrDavid5465/telemetry-admin/commit/a248509c0969e8dd25c2b9f13d61627d98814ade))
