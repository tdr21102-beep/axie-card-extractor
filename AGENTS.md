# AXIE / CARD EXTRACTOR — Agent Rules

## Project

Desktop Windows tool for the AXIE / CARD EXTRACTOR + CARD STUDIO pipeline.

Stack:
- Electron
- React
- Vite
- TypeScript
- Node
- Decoupled renderer/backend
- Validated IPC

Preserve the existing architecture and working functionality.

## Repository Safety

Never run without explicit user authorization:
- git reset
- git checkout when it would discard changes
- git clean
- git commit
- git push

Always preserve the existing working tree.

Do not overwrite or discard unrelated user changes.

## Architecture

Maintain this separation:

UI
→ IPC
→ services/backend
→ filesystem/renderer

React must not directly write project files or contain important backend logic.

Reuse existing abstractions before introducing new ones.

Avoid unnecessary architectural rewrites.

## Asset Safety

RAW / Original assets are immutable.

Never modify, regenerate, replace, normalize, optimize, or destroy original RAW assets.

Keep strictly separated:
- RAW / Original
- Clean Base
- Rendered Card
- Game Metadata
- Game JSON
- Game Export

Clean Base imports must preserve their original bytes.

Replacing a Clean Base may invalidate derived Rendered output but must not modify:
- RAW
- gameplay
- metadata implicitly

## Card Studio

Preserve existing Card Studio V1, V2 and V3 behavior unless the task explicitly changes it.

Current rendering contract:

Clean Base PNG
+ Game Metadata visual
+ Versioned Card Layout
→ Rendered Card PNG

Clean Base contains fixed visual elements such as:
- artwork
- frame
- panel backgrounds
- energy orb
- tabs
- part/class icons
- fixed decorations

Card Studio renders variable visual metadata:
- cost
- value
- name
- card_type
- description

## Visual Metadata vs Gameplay

Visual metadata and gameplay are separate systems.

Never infer gameplay from visual metadata.

Important invariants:

value != damage

description != effect

Gameplay comes exclusively from structured gameplay data such as:
- targeting
- effects[]

The renderer must not execute or infer gameplay.

Attack cards require explicit valid gameplay effects according to existing validation rules.

## Layout / Renderer

The current master logical layout space is:

1024 × 1536
2:3 aspect ratio

Preserve compatibility with supported legacy 2:3 assets.

Avoid scattered magic numbers.

Layout configuration belongs in the versioned card layout system.

Preserve deterministic rendering.

For pixel-art raster resizing:
- use nearest-neighbor where applicable
- no blur
- no sharpen
- no bilinear filtering
- no bicubic filtering
- no automatic recoloring

Keep image smoothing disabled where required by the renderer.

Custom font assets must use the existing font_asset mechanism.

Do not automatically download or package fonts with uncertain licensing.

## Reload Layout

Reload Layout must:
- reread config/card_layout.json from disk
- validate before replacing the active layout
- preserve the last valid layout if reload fails
- never modify metadata or gameplay
- never modify RAW or Clean Base
- allow preview regeneration without restarting Electron

React must not parse the layout independently.

## Extractor / Export Regression Safety

Do not break:
- Card Catalog
- Batch Export
- Card Studio
- Game Card Export
- Game Set Export
- existing manifests
- hashes
- deterministic ordering
- safe reruns
- existing First Battle Set workflow

The official catalog currently contains 192 cards.

## Testing

Run relevant localized tests after changes.

For meaningful renderer/backend changes also run, when applicable:
- full test suite
- typecheck
- build
- relevant acceptance tests
- regression tests

Do not weaken or remove tests merely to make a change pass.

Strict TDD is not required.

## Development Style

Prefer incremental and localized changes.

Do not redesign working architecture unless the task explicitly requires it.

Avoid unnecessary dependencies, context usage, agents, or complexity.

Preserve Windows portable compatibility.

When a bug can be fixed at its actual source, do not hide it with card-specific offsets or unrelated layout hacks.