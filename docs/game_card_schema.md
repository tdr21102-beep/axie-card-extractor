# Game card contract

This document defines the stable Card Studio V2 contract intended for a later Axie Infinity Fantasy Godot importer. Card Studio validates and exports data; it does not execute battle mechanics and does not modify the Godot project.

## Saved gameplay metadata

Files below `cards/data/<class>/<card_id>.json` use `schema_version: 2`:

```json
{
  "schema_version": 2,
  "id": "furball",
  "name": "Furball",
  "class": "beast",
  "part": "back",
  "cost": 1,
  "value": 40,
  "card_type": "attack",
  "description": "Deal 2 hits.",
  "targeting": { "mode": "single_enemy" },
  "effects": [
    {
      "id": "damage_1",
      "type": "damage",
      "target": "selected",
      "amount": 20,
      "hits": 2
    }
  ]
}
```

`description` is display text only. Consumers must use the ordered `effects` array for gameplay. Card Studio never derives executable effects from prose.

## Clean Base and deterministic rendering

The imported `cards/clean/<class>/<card_id>.png` is a byte-preserving **Clean Base**: it contains the fixed artwork, frame, background, energy orb, tabs, and icons, but not variable metadata. Card Studio composes `cost`, `value`, `name`, `card_type`, and `description` using the versioned `config/card_layout.json` in logical master space 1024×1536. The layout accepts legacy 2:3 assets without changing their output dimensions, and maps gameplay `card_type` values to display labels through `card_type_display`. Missing `font_asset` files use the configured system-family fallback; no font is downloaded automatically.

### Identity and visual fields

- `id`, `class`, and `part` are derived from immutable source-catalog identity and must match that source card.
- `name`, `cost`, `value`, `card_type`, and `description` are editable visual/game metadata used by the deterministic renderer.
- `card_type` is an extensible string. `attack`, `skill`, `secret`, and `power` are configured initial suggestions, not a closed gameplay enum.

### Targeting vocabulary

The initial vocabulary is `self`, `selected`, `single_enemy`, `single_ally`, `all_enemies`, and `all_allies`. `targeting.mode` describes how a future battle UI selects targets. Each effect also declares its resolved target vocabulary. Card Studio validates these values but does not select entities.

### Effect union

Every effect has a unique stable `id`, a discriminating `type`, a `target`, and only its type-specific fields:

- `damage`: positive integer `amount` and integer `hits >= 1`.
- `heal`: positive integer `amount`.
- `shield`: positive integer `amount`.
- `buff`: non-empty `status`, integer `stacks >= 1`, integer `duration >= 1`.
- `debuff`: non-empty `status`, integer `stacks >= 1`, integer `duration >= 1`.
- `cleanse`: integer `count >= 1`.

The discriminated union can gain `poison`, `rage`, `feathers`, `bubbles`, or other types in later schema revisions without adding irrelevant nullable fields to existing effects. This version does not implement those mechanics.

## V1 compatibility

A legacy JSON without `schema_version`, `targeting`, or `effects` is treated as V1. Loading migrates it deterministically in memory to V2 with `targeting.mode = single_enemy` and an empty `effects` array. Loading never rewrites the user's file. An explicit Save validates identity and persists the V2 representation.

## Game export package

`Export Game Card` writes:

```text
<export_root>/game_export/<class>/<card_id>/
├── card.png
└── card.json
```

`card.json` contains all V2 fields plus:

```json
{
  "package_schema_version": 1,
  "visual": {
    "source": "original_placeholder",
    "file": "card.png",
    "sha256": "<64 lowercase hex characters>",
    "warning": "Embedded text may not match Game Metadata"
  }
}
```

`visual.source` is `original_placeholder` when `card.png` is a byte-identical copy of the Sanity original, or `rendered` when it is the deterministic composition of a clean asset plus visual metadata. Godot should verify `visual.sha256`, treat `visual.file` as package-relative, and consume gameplay only from the structured V2 fields.

Both files are conflict-safe: an identical existing package is skipped, while different existing bytes are reported as a conflict rather than overwritten.

## Production documents (Card Studio V3)

Production organization is intentionally separate from saved gameplay metadata. A versioned set is stored at `cards/sets/<set_id>.json`:

```json
{
  "schema_version": 1,
  "id": "first_battle_set",
  "name": "First Battle Set",
  "cards": ["<stable catalog id>"],
  "axies": [
    {
      "id": "axie_01",
      "name": "Starter Beast",
      "cards": ["<stable catalog id>"]
    }
  ]
}
```

Set and slot membership use immutable source-catalog IDs as foreign keys. Display names are not keys, the same card may belong to several sets, and deleting a slot does not delete the card or its metadata. Passive parts/traits are outside this schema version.

Recovery drafts live separately at `cards/drafts/<class>/<card_id>.json`, use `schema_version: 1`, and keep the source card ID plus an unconfirmed metadata snapshot. A draft may contain temporarily invalid editor values. Restoring is explicit; loading or saving a draft never overwrites confirmed `cards/data` metadata.

Production status is derived rather than persisted: `UNCONFIGURED` has no confirmed metadata; `DRAFT` has unreadable, identity-mismatched, or structurally invalid metadata; `VALID` has valid V2 metadata but lacks a currently exportable visual source or an extensible readiness rule; `GAME_READY` has valid V2 metadata, no blocking readiness error, and at least one real exportable source. Warnings do not block readiness. `CLEAN_AVAILABLE` and `RENDERED_AVAILABLE` require real PNG files and are never inferred from the original placeholder.

## Game Set export

`Export Game Set` writes the following deterministic structure:

```text
<export_root>/game_export/<set_id>/
├── manifest.json
├── report.json
└── cards/<class>/<card_id>/
    ├── card.png
    └── card.json
```

The versioned manifest contains `set_id`, `set_name`, exported cards, Axie Slots, and `export.card_count`. Card package paths are POSIX-style and relative to the set directory; absolute Windows paths and timestamps are forbidden. Cards are ordered deterministically and record SHA-256 plus visual source. A different pre-existing file is a conflict and is never overwritten. Re-running identical exports is safe; reports use the next available deterministic suffix when a new result differs.
