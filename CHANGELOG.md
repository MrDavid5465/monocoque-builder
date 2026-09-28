# Changelog

## [0.5.0](https://github.com/MrDavid5465/monocoque-builder/compare/monocoque-builder-v0.4.0...monocoque-builder-v0.5.0) (2026-09-28)


### Features

* **360-viewer:** paint the ambient tint above the night overlay ([c526685](https://github.com/MrDavid5465/monocoque-builder/commit/c526685375392a8813719c8223a02ae6ffa8586f))
* **360:** extra night darkening for photos that aren't dark enough ([5fd0b0b](https://github.com/MrDavid5465/monocoque-builder/commit/5fd0b0bf117b5abb81addbe580b7c5519b4bd266))
* **360:** take the extra night darkening from ~10% to ~20% ([9ed2374](https://github.com/MrDavid5465/monocoque-builder/commit/9ed237413561cb2e8d7ec3ebf7db027440cce2c3))
* **ac-telemetry:** send commands into the running game ([c581e95](https://github.com/MrDavid5465/monocoque-builder/commit/c581e95a9ef8560f63917935c2fed9cba67a184e))
* **ac:** automated 360 photo capture and extended AC telemetry ([6b59e2d](https://github.com/MrDavid5465/monocoque-builder/commit/6b59e2dcfd384cc561e8f97614520f39a8df51f9))
* **ambient-lights:** gate settings behind a Huenicorn-installed check ([02d1121](https://github.com/MrDavid5465/monocoque-builder/commit/02d1121cf3c41a8bac8da4acba6e99c4945fa1cc))
* **ambient-lights:** sim-driven ambient tinting via Huenicorn ([cd8a36d](https://github.com/MrDavid5465/monocoque-builder/commit/cd8a36d9e43fccaa5c92f2205e44c1cde4cfe678))
* **ambient-lights:** soft-light 360 blend, channel mapping, screen reselect ([92c20ba](https://github.com/MrDavid5465/monocoque-builder/commit/92c20ba509f0d73397101f46ba3d0e22a22b8296))
* **ambient-lights:** split saturation boost into day/night values ([42e87fc](https://github.com/MrDavid5465/monocoque-builder/commit/42e87fc6971609c9c16b4ea31cda526edf687e72))
* **capture:** join a live Proton prefix instead of refusing to start ([76a655c](https://github.com/MrDavid5465/monocoque-builder/commit/76a655c1e0c0649785385321921baad3e45a50be))
* **capture:** shoot cars in a generated showroom track ([d7a032b](https://github.com/MrDavid5465/monocoque-builder/commit/d7a032b1b32a47222e5528e8e7f365bd1a837df1))
* **dashboard-designer:** add clock-text and clock-sprite components ([654529f](https://github.com/MrDavid5465/monocoque-builder/commit/654529f12e190dee58d1529dc1adb0621faf6653))
* **dashboard-designer:** add sprite crop tool, fix kiosk pan/zoom lockout, live per-car 360 pan sync ([3f7a327](https://github.com/MrDavid5465/monocoque-builder/commit/3f7a327880b3dbe2731070e816be927d2d7c709a))
* **dashboard-designer:** add transform-sprite component + limit-behavior on telemetry bindings ([218506c](https://github.com/MrDavid5465/monocoque-builder/commit/218506ce59fc8036972639b9f946d0b6da4cb13c))
* **dashboard-designer:** rework telemetry binding UI, fix startup sweep, bundle template sprites ([9eb916d](https://github.com/MrDavid5465/monocoque-builder/commit/9eb916d1fc169e0a2240e1cd5508e4eaa014fde9))
* **dashboard:** persist NeckFX per-axis gain/disable, dedupe the angle clamp ([d6c5be4](https://github.com/MrDavid5465/monocoque-builder/commit/d6c5be4174d119d0bb80178fe7cb31e19dc5b174))
* **day/night:** drop the hand-editable sunrise/sunset fields ([42015b8](https://github.com/MrDavid5465/monocoque-builder/commit/42015b8030cb95be662934bef847258a1171a36a))
* **day/night:** key the dawn/dusk blend on sun elevation, eased ([cc12307](https://github.com/MrDavid5465/monocoque-builder/commit/cc12307acd0bab2361bc2f78a0be249a92ed01e0))
* **flatpak:** upload .flatpak as a build artifact on every run ([00c79d2](https://github.com/MrDavid5465/monocoque-builder/commit/00c79d25cdf7851242d9fed19b045ada27484051))
* **per-form:** first-class `list` field for repeating rows ([62b94e3](https://github.com/MrDavid5465/monocoque-builder/commit/62b94e347a4bab49e468e07af352d5590d44ee97))
* **per-form:** migrate hand-rolled repeating rows to the `list` field ([7e9608a](https://github.com/MrDavid5465/monocoque-builder/commit/7e9608adb4e232b4a03445b72a1d8b6aa814c444))
* rename the app to Monocoque Builder ([983deff](https://github.com/MrDavid5465/monocoque-builder/commit/983deffccffef77f20c6cea7cf560d7db0424575))
* rename to Monocoque Builder, and make the Flatpak and packaged artifacts actually work ([e65a023](https://github.com/MrDavid5465/monocoque-builder/commit/e65a02365d20b0caa97ec3cf78a9098af57ea15e))
* **services:** configurable service commands, liveness checks, restart backoff ([91d7243](https://github.com/MrDavid5465/monocoque-builder/commit/91d72431de1b12183798da6759125c27ca0b5a7f))
* **shakers:** wire device config export to monocoque; add Moza shift-light + device pickers ([d17dd98](https://github.com/MrDavid5465/monocoque-builder/commit/d17dd982a1a22db2f8f92238910195ab3ba27712))
* **skills:** add completing-prs skill ([1b9e5d4](https://github.com/MrDavid5465/monocoque-builder/commit/1b9e5d47c00f17bcd804f331339e931b53cdb869))
* **skills:** add form-schema skill with static schema validator ([dbdfd1c](https://github.com/MrDavid5465/monocoque-builder/commit/dbdfd1c5c855ce6230569e731ca07cf1531d29a1))
* **skills:** add list-schema skill ([8d64721](https://github.com/MrDavid5465/monocoque-builder/commit/8d64721950150bcd01644825aad7702c560dd2fb))
* **skills:** add reactive-admin skill ([e488517](https://github.com/MrDavid5465/monocoque-builder/commit/e488517a37a2f4dedc329c31618e3144fb5ed826))
* **skills:** add validate-list-schema.cjs to list-schema ([bac9150](https://github.com/MrDavid5465/monocoque-builder/commit/bac9150d805b163db26f3174fd49ff85a9b89d05))
* **sun:** compute sun elevation, and carry AC's equinox trajectory flag ([174f999](https://github.com/MrDavid5465/monocoque-builder/commit/174f9992d7586fdf855b0378c5068d9ba83304fb))
* **telemetry-admin:** add track locations with sunrise/sunset computation ([47bf76c](https://github.com/MrDavid5465/monocoque-builder/commit/47bf76c65584013b24815c62a452bab31a6a6e80))
* **telemetry-admin:** server-authoritative simulated day/night clock ([85287a5](https://github.com/MrDavid5465/monocoque-builder/commit/85287a5a98b611b9234c7d12f9283d0fd79c4ec6))
* **tracks:** select track ids from telemetry instead of typing them ([c742c7c](https://github.com/MrDavid5465/monocoque-builder/commit/c742c7c5193dbbd474d58d2df2b7307205830812))
* **typical-admin:** per-row delete in the table view, single Add button ([692d8ed](https://github.com/MrDavid5465/monocoque-builder/commit/692d8eddca9f218c1b84e2ba2a9d2977f6607dd7))
* **typiql:** backend support for day/night clock, track locations, and Moza shift-light devices ([4560fde](https://github.com/MrDavid5465/monocoque-builder/commit/4560fdee48006ca629718cf56bfd9b5e5faaf14a))


### Bug Fixes

* **360-viewer:** darken the scene at night even when the car has a night photo ([6c195e9](https://github.com/MrDavid5465/monocoque-builder/commit/6c195e963beac0ca6a269f0ebbe7d2c7d06e9fad))
* **360-viewer:** drop the rolling-baseline gate that faded the ambient tint out ([cda0b3c](https://github.com/MrDavid5465/monocoque-builder/commit/cda0b3cc1a8ac30d0d7ac5e590968d99b70e6c9e))
* **360-viewer:** move night darkening into the shader so the tint survives it ([de0aeba](https://github.com/MrDavid5465/monocoque-builder/commit/de0aeba72eb92a2ea82302db247b3c472e020c73))
* **360-viewer:** restore the night overlay for cars without a night photo ([113e033](https://github.com/MrDavid5465/monocoque-builder/commit/113e0337306cd11426ae0bdab2f32397fdcb4deb))
* **360:** add heave to pitch, fix free-look clamp and axis inversion ([d90faa2](https://github.com/MrDavid5465/monocoque-builder/commit/d90faa23684f300b966d467e48db28a370611a93))
* **360:** make the night darkening 20% of the untouched photo ([0a90f35](https://github.com/MrDavid5465/monocoque-builder/commit/0a90f35a583a596f15387f36372076a46649347d))
* **360:** size the neck clamp from CSP config, keep AC telemetry 1:1 ([dfe23bc](https://github.com/MrDavid5465/monocoque-builder/commit/dfe23bcfc7778e104057a86d15fa6e0529788365))
* **ac-telemetry:** carry the send accumulator, and report frame age ([eb3a333](https://github.com/MrDavid5465/monocoque-builder/commit/eb3a33354b4b6560ebfc2d07ea7ff78925ce3c0e))
* **capture:** fail fast when AC dies, and report what it actually said ([0feca42](https://github.com/MrDavid5465/monocoque-builder/commit/0feca429e44f12c5dee86a37d07659cd518547b3))
* **capture:** refuse to start alongside a running Content Manager ([91920a1](https://github.com/MrDavid5465/monocoque-builder/commit/91920a1fc8a59e50da7e394e0780d1e6da0dab9d))
* **capture:** the game answers to a different name once it is running ([0ac6b95](https://github.com/MrDavid5465/monocoque-builder/commit/0ac6b9594d43a278f2f3a04e4198f6659166bbe3))
* **cargo:** sync stale version in Cargo.lock ([1b06991](https://github.com/MrDavid5465/monocoque-builder/commit/1b06991f23ed644653e15db67e16e6b33105378b))
* **cargo:** sync the stale version in Cargo.lock ([7807f1b](https://github.com/MrDavid5465/monocoque-builder/commit/7807f1bfa17740b0f951ec88116ce63900075db6))
* **cars:** refresh a car's photo previews when its photos change ([867003a](https://github.com/MrDavid5465/monocoque-builder/commit/867003a6c2e9ddf459c8579604d70ca6a1f3d6ef))
* **ci:** publish-aur download URL used wrong release tag format ([f450247](https://github.com/MrDavid5465/monocoque-builder/commit/f450247d5bca1c300145b5afd78e4f78be6ea7c4))
* **ci:** publish-aur GIT_SSH_COMMAND instead of relying on ~/.ssh/config ([f365600](https://github.com/MrDavid5465/monocoque-builder/commit/f365600dee1372ef37d441471aee91a15a8656ff))
* **ci:** repair the two checks the rename broke ([718f278](https://github.com/MrDavid5465/monocoque-builder/commit/718f278b0b68e6abb3fa7e069a687072c5ccee9d))
* **ci:** stop creating draft GitHub Releases ([8b3092f](https://github.com/MrDavid5465/monocoque-builder/commit/8b3092f8b22445281327083453230bd93eccf7a7))
* **ci:** use StrictHostKeyChecking=accept-new for AUR push instead of ssh-keyscan ([dca32d4](https://github.com/MrDavid5465/monocoque-builder/commit/dca32d43c2f375c452a7354d15a8e252e77c4dc2))
* **dashboard-designer:** eliminate render-depth crash, add backend-restart auto-recovery ([879c125](https://github.com/MrDavid5465/monocoque-builder/commit/879c1253f955ef919ed64ea3737dd45170834146))
* **dashboard-designer:** fix no-useless-assignment lint error in TransformOverlay ([0bfd52d](https://github.com/MrDavid5465/monocoque-builder/commit/0bfd52d98abc6551e70a826afbe32bd4090c538a))
* **dashboard-designer:** merge live-update subscriptions into one hub, fix render-loop instability ([ebe3c44](https://github.com/MrDavid5465/monocoque-builder/commit/ebe3c44318a3e9c57aab35a23833655178bdd1c1))
* **dashboard-designer:** show canvas edge in edit mode, retry flaky thumbnail capture ([929c249](https://github.com/MrDavid5465/monocoque-builder/commit/929c249200fb4946f78a69aa5789542ef2b4c85e))
* **dashboard-designer:** single WebGL context for 360 viewer day/night blend ([8c71545](https://github.com/MrDavid5465/monocoque-builder/commit/8c71545cf0b2276adf9315999cbaf17d19f4f20d))
* **dashboards:** stop cropping dashboard thumbnails in the list view ([2480643](https://github.com/MrDavid5465/monocoque-builder/commit/2480643f6805be0f0a7b7cf6ae383536ccf393d0))
* **day/night:** bias the blend toward night, and stop ghosting the day photo ([4f1c169](https://github.com/MrDavid5465/monocoque-builder/commit/4f1c16999af64809ae64f2a6488d3df4a0b05bcf))
* **day/night:** give dusk its own elevation band, and report track timezone ([e922c49](https://github.com/MrDavid5465/monocoque-builder/commit/e922c4909cbf4fd14f767b44d84ef74e6cea882a))
* **day/night:** select elevation on the hub's own subscription, and apply the ([1ce3bef](https://github.com/MrDavid5465/monocoque-builder/commit/1ce3bef7de43f532bc9c1e8aa218facf63bffe93))
* **day/night:** stop the elevation blend freezing, and don't re-decide the date ([5adacf5](https://github.com/MrDavid5465/monocoque-builder/commit/5adacf51dbd8e417a53659bd7c32d5b5f8f98e63))
* **day/night:** use the MEASURED dusk band rather than mirroring dawn ([681be8f](https://github.com/MrDavid5465/monocoque-builder/commit/681be8f7dfdcb6920494ee0d3491c391d5ecb7bf))
* **deps:** remove stale @octant/per-form git dependency ([f65859f](https://github.com/MrDavid5465/monocoque-builder/commit/f65859fa5a27bb348ed0d0fa85ed7e69b84145de))
* **design-sync:** silence the unused car fixture in two previews ([5855d39](https://github.com/MrDavid5465/monocoque-builder/commit/5855d397cff7977f807707a53e217e0586b0380b))
* **diag:** separate the init script from Tauri's IPC bootstrap ([b2e203e](https://github.com/MrDavid5465/monocoque-builder/commit/b2e203e320451beae7639ac6b7cca0cae77782f1))
* **e2e:** repair gauge-setup suite for current app shape ([a248509](https://github.com/MrDavid5465/monocoque-builder/commit/a248509c0969e8dd25c2b9f13d61627d98814ade))
* find services by which Flatpak provides them, and ship dist in every package ([8ff8693](https://github.com/MrDavid5465/monocoque-builder/commit/8ff8693355bc8d0bba1d14fafd7314b7670d5729))
* first-run config creation, and host access under Flatpak ([52b7161](https://github.com/MrDavid5465/monocoque-builder/commit/52b716137f9dadf637392013c6946f1bc746018c))
* **flatpak:** add --allow-git=all to npm ci for the per-form git dependency ([3464e7d](https://github.com/MrDavid5465/monocoque-builder/commit/3464e7d57ee29ac996927f718263ab0c84a3d82d))
* **flatpak:** add --share=network for monocoque connectivity ([eaa21c5](https://github.com/MrDavid5465/monocoque-builder/commit/eaa21c50ba8e50efdb6e54eece941394dafa3a05))
* **flatpak:** build with custom-protocol so the window loads the app ([e3a6988](https://github.com/MrDavid5465/monocoque-builder/commit/e3a69882576339743f5a5154351d2f0c3c896faa))
* **flatpak:** drop --locked from the sandboxed cargo build ([abef599](https://github.com/MrDavid5465/monocoque-builder/commit/abef59937df291c5279414aadc715cb870cbe475))
* **flatpak:** fetch the two git submodules explicitly ([1d39d00](https://github.com/MrDavid5465/monocoque-builder/commit/1d39d002ec7106ad8ab889a50e160d241674e789))
* **flatpak:** fix path/cache bugs found running flatpak-builder for real ([458bdb9](https://github.com/MrDavid5465/monocoque-builder/commit/458bdb90b5de4dab6a66bb4294bb7baaee4912f9))
* **flatpak:** install appstream for appstream-compose ([7aa5b59](https://github.com/MrDavid5465/monocoque-builder/commit/7aa5b59574af455915432072331a114a74b7a57a))
* **flatpak:** install libarchive-tools for bsdunzip ([7c2d26d](https://github.com/MrDavid5465/monocoque-builder/commit/7c2d26df2f5e287baf84bba26db50e9ad2e9ac23))
* **flatpak:** match the window to its desktop entry for the icon ([ac00c98](https://github.com/MrDavid5465/monocoque-builder/commit/ac00c989396fa7acf3d751a53b0e92bb3970ed0b))
* **flatpak:** share the host /dev/shm so telemetry is visible at all ([8e90c3a](https://github.com/MrDavid5465/monocoque-builder/commit/8e90c3a0d43586c19127a095c6453ee10dc85de0))
* **flatpak:** show "Telemetry Admin" in the launcher, not "typiql" ([e18b618](https://github.com/MrDavid5465/monocoque-builder/commit/e18b61893f2f71d4e1f7c359b60bc7e93184cd49))
* **flatpak:** symlink bsdunzip to bsdtar ([739a730](https://github.com/MrDavid5465/monocoque-builder/commit/739a73078fe492020cbaf9b9276534f114dbb8bb))
* **flatpak:** symlink bsdunzip to unzip, not bsdtar ([c42eb41](https://github.com/MrDavid5465/monocoque-builder/commit/c42eb4186b17d9e1684a313265fd9357334dd766))
* **flatpak:** use flatpak project's PPA for a newer native flatpak-builder ([c326494](https://github.com/MrDavid5465/monocoque-builder/commit/c326494e2e45ff98074b2a5b71d3d71c75067ed8))
* **flatpak:** use org.flatpak.Builder instead of apt's flatpak-builder ([a1655bf](https://github.com/MrDavid5465/monocoque-builder/commit/a1655bf4b1492b7e094eb3df7b265dad90c1aa7b))
* **gamepad:** create the virtual controller at startup, not on first press ([a28ec8e](https://github.com/MrDavid5465/monocoque-builder/commit/a28ec8e416836c7750a9a7e5df6ce689567132fd))
* **gamepad:** report udev status by capability, not by artifact ([8a6e307](https://github.com/MrDavid5465/monocoque-builder/commit/8a6e307921d6167e5f121ef6a1b9e29be3368555))
* **live-updates:** make admin pages refetch on changes, over the shared hub ([9857eb5](https://github.com/MrDavid5465/monocoque-builder/commit/9857eb5afe302563f9220daef6c14a8f0cee228b))
* **neckfx:** ease the sway on a clock, not on a frame counter ([9d3f119](https://github.com/MrDavid5465/monocoque-builder/commit/9d3f119c13c9413f85103dafb25c82f3ee88d27d))
* **per-form:** timetoday field's dropdowns open downward instead of sideways ([3992dcf](https://github.com/MrDavid5465/monocoque-builder/commit/3992dcf9b5bd67be2f4d038b63bf0ada71141064))
* restore missing 360-photo links, stop caching errors forever, allow uinput ([a820ab4](https://github.com/MrDavid5465/monocoque-builder/commit/a820ab43a1b0a31332958b97072c726743739b7c))
* **routes:** stop putting the dashboards app's name in the URL twice ([9b213b2](https://github.com/MrDavid5465/monocoque-builder/commit/9b213b251420e104483f7b4af50c5257dbc03ab5))
* **routing:** make kiosk deep links resolve ([e263a89](https://github.com/MrDavid5465/monocoque-builder/commit/e263a89631eb8c0bd80d950167db267e886f25fb))
* serve the frontend from an absolute path, and ship it in the Flatpak ([36a61ca](https://github.com/MrDavid5465/monocoque-builder/commit/36a61ca03e1917c38add427d540957269cc4577f))
* share the host cache directory, where thumbnails have no other source ([8f070bd](https://github.com/MrDavid5465/monocoque-builder/commit/8f070bd942579f24c64453a7c0371639fb92d97d))
* **skills:** clarify reactive-admin only needs overrides passed ([2f8b2da](https://github.com/MrDavid5465/monocoque-builder/commit/2f8b2dac4be69d9a814894811a1e8ed399813318))
* stage host-bound files where the host can actually see them ([c7daddd](https://github.com/MrDavid5465/monocoque-builder/commit/c7dadddf40b35f1f372fd5f9a4731895e3e4e1d7))
* start services the host can actually reach when sandboxed ([a036e29](https://github.com/MrDavid5465/monocoque-builder/commit/a036e29f0c9d695a9c94983a5900f86e9125ef38))
* start the day/night ramp at sunrise/sunset instead of centering it ([2a1cd8a](https://github.com/MrDavid5465/monocoque-builder/commit/2a1cd8a827c5de1987946e1755f07839645de327))
* **sun:** stop negating longitude, and fix the test that hid it ([cb9d565](https://github.com/MrDavid5465/monocoque-builder/commit/cb9d565023963d9ebbee4fae589abdd0fb1f5ae2))
* **sun:** take the track's position from the game, and store sun times local ([2918dfc](https://github.com/MrDavid5465/monocoque-builder/commit/2918dfcdc633e3acc59356689978ecf13ca78976))
* **sun:** the game's clock is track-local, not UTC ([b4d1b92](https://github.com/MrDavid5465/monocoque-builder/commit/b4d1b92de90d54f8e608888b8a7e1977e0e48e08))
* use the host's data directory under Flatpak, and name the real error ([8df97c2](https://github.com/MrDavid5465/monocoque-builder/commit/8df97c2c1610ff291eb6385e3a8c24dfc8e7944d))

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
