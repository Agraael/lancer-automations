# Lancer Automations — AI Context

## Module Identity
- **ID**: `lancer-automations`
- **System**: Foundry VTT v12 + Lancer system
- **Version**: 2.5.1
- **Entry points** (esmodules in module.json): `scripts/main.js`, `scripts/overwatch.js`, `scripts/grapple.js`

## Purpose
Provides a reaction/automation framework for Lancer: any item or "general" automation can register callbacks that fire on game events (attacks, moves, damage, activations, turn changes, status effects, etc.).

---

## Architecture Overview

### Core Loop
1. Lancer system fires flow steps (attack, damage, activation, etc.)
2. `main.js` intercepts them via `flowSteps.set(...)` registered in `Hooks.on('lancer.registerFlowSteps', ...)`
3. Each step calls `handleTrigger(triggerType, triggerData)` → `checkReactions()` + `processEffectConsumption()`
4. `checkReactions()` iterates all scene tokens, checks item-based and general reactions, evaluates `evaluate()`, then calls `activateReaction()` / `displayReactionPopup()`

### Reaction Types
- **Item reactions** (`ReactionManager.getReactions(lid)`): keyed by item LID. Registered via `api.registerExternalItemReactions()`
- **General reactions** (`ReactionManager.getGeneralReactions()`): named global automations. Registered via `api.registerExternalGeneralReactions()`
- **Startup scripts**: run once on `ready`. Registered via `ReactionManager.builtinStartups` or settings

### Reaction Config Shape
See `scripts/types.js` → `@typedef ReactionConfig` for the full annotated structure.

Key fields:
- `triggers: TriggerType[]` — which events activate this
- `evaluate(triggerType, triggerData, reactorToken, item, activationName, api) => boolean` — should this fire? Must be synchronous for cancel-capable triggers.
- `activationCode(triggerType, triggerData, reactorToken, item, activationName, api) => Promise<void>` — what to do when triggered
- `onInit(token, item, api) => Promise<void>` — runs once when a token enters the scene/combat

### TriggerData Shapes
All trigger data shapes are fully typed in `scripts/types.js`.

Key patterns:
- `triggerData.triggeringToken` — the token that caused the trigger (except `onPreMove` which uses `triggerData.token`)
- `triggerData.distanceToTrigger` — distance from reactorToken to triggeringToken (added by engine automatically)
- Some triggers add cancellation functions: `cancelAttack`, `cancelTechAttack`, `cancelCheck`, `cancelAction`, `cancelTriggeredMove`
- **Async `evaluate()` cannot use cancel functions** — the engine warns about this

---

## File Responsibilities

| File | Purpose |
|---|---|
| `scripts/main.js` | Core: hook registration, `handleTrigger`, `checkReactions`, reaction evaluation loop, flow step registration, socket handling, module API assembly |
| `scripts/reaction-manager.js` | Settings storage, `ReactionConfig` type, `stringToFunction`/`stringToAsyncFunction` (compile user code strings), script cache |
| `scripts/reactions-registry.js` | Built-in general reactions (Overwatch, Brace, etc.), external reaction registry |
| `scripts/reactions-ui.js` | GM popup dialog, reaction choice UI |
| `scripts/flagged-effects.js` | `EffectsAPI`: create/remove/consume ActiveEffects with `lancer-automations` flags; notification batching |
| `scripts/effectManager.js` | `EffectManagerAPI`: higher-level effect management |
| `scripts/overwatch.js` | `OverwatchAPI`: overwatch threat range checking |
| `scripts/grapple.js` | Grapple mechanics |
| `scripts/genericBonuses.js` | `BonusesAPI`: immunity/resistance/accuracy bonus injection into flow steps |
| `scripts/interactive-tools.js` | `InteractiveAPI`: `chooseToken`, knockback, movement history/revert, choice cards |
| `scripts/misc-tools.js` | `MiscAPI`: `getItemLID`, `isItemAvailable`, `hasReactionAvailable` |
| `scripts/flows.js` | `SimpleActivationFlow` registration |
| `scripts/grid-helpers.js` | Hex path calculation, hex drawing utilities |
| `scripts/terrain-utils.js` | `TerrainAPI`: terrain awareness |
| `scripts/scan.js` | `ScanAPI`: SCAN action logic |
| `scripts/downtime.js` | `DowntimeAPI` |
| `scripts/aura.js` | `LAAuras`, `AurasAPI`: grid-aware aura integration |
| `scripts/compendium-tools.js` | `CompendiumToolsAPI` |
| `scripts/reaction.js` | Reaction document model |
| `scripts/reaction-manager.js` | ReactionManager class + settings |
| `scripts/reaction-export-import.js` | Import/export of reaction configs |
| `scripts/reaction-reset.js` | Per-turn reaction availability reset |
| `startups/itemActivations.js` | Built-in item-specific automation definitions (startup scripts) |
| `scripts/types.js` | **JSDoc typedefs only** — not imported at runtime |

---

## Module API
Accessed as `game.modules.get('lancer-automations').api` or as the `api` parameter in callbacks.
Composed from: `OverwatchAPI`, `ReactionsAPI`, `EffectsAPI`, `BonusesAPI`, `InteractiveAPI`, `MiscAPI`, `CompendiumToolsAPI`, `EffectManagerAPI`, `TerrainAPI`, `DowntimeAPI`, `ScanAPI`, `AurasAPI`, plus internal main.js helpers.

Full type in `scripts/types.js` → `@typedef LancerAutomationsAPI`

---

## Key Patterns & Conventions

### Globals
Files use `/*global game, canvas, ui, ChatMessage, ... */` JSDoc comments to declare Foundry globals for ESLint. Do not remove these.

### Evaluate must be synchronous for blocking triggers
Triggers `onPreMove`, `onInitAttack`, `onInitTechAttack`, `onInitCheck`, `onInitActivation`, `onPreStatusApplied`, `onPreStatusRemoved` use cancel functions that only work synchronously. Async `evaluate()` with these triggers logs a warning and the cancel is ignored.

### `forceSynchronous` flag
Set on a ReactionConfig to suppress the async-evaluate warning when the user intentionally accepts the limitation.

### Effect flags
Effects created by this module use `flags['lancer-automations']` for metadata (e.g. `suppressSourceId`).

### Socket
Multiplayer coordination is done via `game.socket.on('module.lancer-automations', handleSocketEvent)`. Reaction popups are serialized/deserialized across clients. `serializeTriggerData` / `deserializeTriggerData` handle Token references.

### Caches
- `cachedFlatGeneralReactions` — flattened reaction list, cleared on `lancer-automations.clearCaches` hook
- `_reactionItemsCache` — per-actor item list, cleared on `updateActor`/`createItem`/`deleteItem`/`updateItem`
- `scriptCache` in `reaction-manager.js` — compiled function cache for string-based user scripts

### Error boundary
All `evaluate()` and `activationCode()` calls are wrapped in try/catch; errors are logged to console, not thrown.

---

## External Dependencies
- **lancer** system (required)
- **lancer-style-library** (required)
- **temporary-custom-statuses** (required) — for custom status/condition effects
- **_CodeMirror** (optional) — for in-app code editor UI
- **token-factions** (optional) — uses its `getDisposition` API when available

---

## Dialog Styling Conventions

All custom dialogs in this module use a **two-layer header** pattern: the native Foundry title bar is hidden and replaced by a styled red banner inside the dialog content.

### Required pattern for any new Dialog
```js
new Dialog({ title: "...", content: ..., buttons: ... }, {
    width: ...,
    classes: ['lancer-dialog-base', 'lancer-no-title']   // REQUIRED — hides native Foundry title bar
})
```

### Inside content HTML
```html
<div class="lancer-dialog-header">
    <div class="lancer-dialog-title">TITLE IN CAPS</div>
    <div class="lancer-dialog-subtitle">Optional subtitle text.</div>
</div>
```

- `lancer-no-title` — hides the native `.window-header` bar (provided by `lancer-style-library`)
- `lancer-dialog-header` — red background banner (provided by `lancer-style-library`)
- Without `lancer-no-title`, two headers stack: the native gray bar on top + the red banner below

### Existing dialogs using this pattern
- `effectManager.js` — `lancer-effect-manager`, `lancer-no-title`
- Most `effectManager.js` sub-dialogs — `lancer-dialog-base`, `lancer-no-title`
- `interactive-tools.js` → Deploy System Items dialog — `lancer-no-title`

---

## AI Workflow Rules

### Never fix automatically
- ESLint formatting errors: `indent`, `semi`, `max-len`, `brace-style`, `no-trailing-spaces`, `eol-last`, `object-property-newline` — user handles these
- `no-unused-vars` warnings — informational only
- Deprecation warnings on functions that still work in Foundry v12

### Do fix
- TypeScript `ts(XXXX)` errors (2304, 2339, 2345, 2322, etc.)
- `eslint no-undef` on a Foundry class → add it to `eslint.config.js` globals, do not change code
- Runtime bugs: wrong property path, genuinely undefined variable

### Type fix priority (in order)
1. Interface augmentation in `scripts/typing/external-globals.d.ts`
2. JSDoc `@param` with specific type on the function
3. Narrow cast: `/** @type {SpecificType} */ (expr)`
4. Last resort: `/** @type {any} */` only on the minimal expression, never the whole object

### False positive signals
- `eslint no-undef` on a Foundry global → missing from `eslint.config.js`, not a real error
- `ts(2339)` property missing → check `external-globals.d.ts` before casting; augment if the property genuinely exists at runtime
- `foundry-vtt-types` library bugs (e.g. `command: null` on Macro) → cast the single field, document why

---

## Important: What NOT to Break
- `/*global ...*/` comments at top of files (ESLint globals)
- `stringToFunction` / `stringToAsyncFunction` — user-authored code strings are compiled here; do not change arg names without updating all call sites
- Socket event shape — changing payload structure breaks multiplayer
- The `api` object spread order in `main.js:2830` — later spreads override earlier ones
