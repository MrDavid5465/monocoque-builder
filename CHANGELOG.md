# Changelog

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
