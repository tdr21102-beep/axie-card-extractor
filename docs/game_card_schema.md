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
