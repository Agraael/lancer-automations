# Lancer Automations — AI Context

## Module Identity
- **ID**: `lancer-automations`
- **System**: Foundry VTT v12 + Lancer system
- **Version**: 2.6.17
- **Author**: Agraael
- **Entry points** (esmodules in module.json): `scripts/main.js`, `scripts/overwatch.js`, `scripts/grapple.js`, `scripts/tah/index.js`
- **Styles**: `styles/codemirror-dark.css`, `styles/interactive-tools.css`
- **Packs**: `macros` (33 compiled macros from `packs_source/macros/`)

## Purpose
Provides a reaction/automation framework for Lancer: any item or "general" automation can register callbacks that fire on game events (attacks, moves, damage, activations, turn changes, status effects, etc.).

---

## Architecture Overview

### Core Loop
1. Lancer system fires flow steps (attack, damage, activation, etc.)
2. `main.js` intercepts them via `flowSteps.set(...)` registered in `Hooks.on('lancer.registerFlows', ...)`
3. Each step calls `handleTrigger(triggerType, triggerData)` -> `checkReactions()` + `processEffectConsumption()`
4. `checkReactions()` iterates all scene tokens, checks item-based and general reactions, evaluates `evaluate()`, then calls `activateReaction()` / `displayReactionPopup()`

### Reaction Types
- **Item reactions** (`ReactionManager.getReactions(lid)`): keyed by item LID. Registered via `api.registerExternalItemReactions()`
- **General reactions** (`ReactionManager.getGeneralReactions()`): named global automations. Registered via `api.registerExternalGeneralReactions()`
- **Startup scripts**: run once on `ready`. Registered via `ReactionManager.builtinStartups` or settings

### Reaction Config Shape
See `scripts/typing/types.d.ts` for the full annotated structure.

Key fields:
- `triggers: TriggerType[]` — which events activate this
- `evaluate(triggerType, triggerData, reactorToken, item, activationName, api) => boolean` — should this fire? Must be synchronous for cancel-capable triggers.
- `activationCode(triggerType, triggerData, reactorToken, item, activationName, api) => Promise<void>` — what to do when triggered
- `onInit(token, item, api) => Promise<void>` — runs once when a token enters the scene/combat
- `onMessage(triggerType, data, reactorToken, item, activationName, api) => Promise<any>` — handles remote messages from `sendMessageToReactor`

### TriggerData Shapes
All trigger data shapes are fully typed in `scripts/typing/types.d.ts`.

Key patterns:
- `triggerData.triggeringToken` — the token that caused the trigger (except `onPreMove` which uses `triggerData.token`)
- `triggerData.distanceToTrigger` — distance from reactorToken to triggeringToken (added by engine automatically)
- Some triggers add cancellation functions: `cancelAttack`, `cancelTechAttack`, `cancelCheck`, `cancelAction`, `cancelTriggeredMove`, `cancelChange`
- **Async `evaluate()` cannot use cancel functions** — the engine warns about this

### Flow Step Registration
`insertModuleFlowSteps()` in `main.js:3332` registers 18+ flow steps into Lancer's flow system. Key steps:
- `onAttackStep` / `onHitMissStep` / `onDamageStep` — BasicAttackFlow, WeaponAttackFlow
- `onTechAttackStep` / `onTechHitMissStep` — TechAttackFlow
- `onCheckStep` / `onInitCheckStep` — StatRollFlow
- `onActivationStep` / `onInitActivationStep` — ActivationFlow, SimpleActivationFlow, SystemFlow, TalentFlow, CoreActiveFlow
- `onStructureStep` / `onStressStep` — StructureFlow, OverheatFlow
- `knockbackInjectStep` / `knockbackDamageStep` — knockback checkbox in damage
- `throwChoiceStep` / `throwDeployStep` — thrown weapon handling
- `genericAccuracyStep*` / `genericBonusStepDamage` — bonus injection
- `statRollTargetSelectStep` — stat roll target selection

### libWrapper Hooks
6 wraps registered in `main.js` init/ready:
1. `MovePenalty.prototype.movementCostForSegment` — elevation immunity bypass
2. `Macros.prototype.get` — lambda callback cache for auras (`aura.js`)
3. `Token.prototype._refreshEffects` — effect collapse duplicate icons (`flagged-effects.js`)
4. `Item.documentClass.prototype.currentProfile` — range bonus application
5. `Item.documentClass.prototype.rangesFor` — range bonus application
6. `Token.prototype._getVisionSourceData` — drag vision multiplier

### API Assembly
In `main.js` ready hook (~line 3742), the module API is composed by spreading sub-APIs:
```
OverwatchAPI -> ReactionsAPI -> EffectsAPI -> BonusesAPI -> InteractiveAPI -> MiscAPI -> CompendiumToolsAPI -> EffectManagerAPI -> TerrainAPI -> DowntimeAPI -> ScanAPI -> AurasAPI -> main.js internals
```
Later spreads override earlier ones. Accessed as `game.modules.get('lancer-automations').api`.

---

## Trigger Types Reference

### Attack Triggers
| Trigger | Cancel fn | Sync required | Key data |
|---|---|---|---|
| `onInitAttack` | `cancelAttack` | Yes | flowState, weapon |
| `onAttack` | — | No | targets, weapon, flowState |
| `onHit` | — | No | targets (hit entries), weapon |
| `onMiss` | — | No | targets (miss entries), weapon |

### Tech Attack Triggers
| Trigger | Cancel fn | Sync required | Key data |
|---|---|---|---|
| `onInitTechAttack` | `cancelTechAttack` | Yes | flowState |
| `onTechAttack` | — | No | targets, flowState |
| `onTechHit` | — | No | targets (hit) |
| `onTechMiss` | — | No | targets (miss) |

### Movement Triggers
| Trigger | Cancel fn | Sync required | Key data |
|---|---|---|---|
| `onPreMove` | `cancelTriggeredMove` | Yes | token, moveInfo, startPos, endPos |
| `onMove` | — | No | distance, elevation, startPos, endPos, isDrag, moveInfo |
| `onKnockback` | — | No | pushedActors, distance, actionName |

### Damage / Structure / Stress
| Trigger | Key data |
|---|---|
| `onDamage` | target, damages, weapon, isCrit, isHit |
| `onStructure` | structureResult |
| `onStress` | stressResult |
| `onHpLoss` | hpDelta, actor |
| `onHeat` | currentHeat, heatDelta |

### Status Triggers
| Trigger | Cancel fn | Sync required | Key data |
|---|---|---|---|
| `onPreStatusApplied` | `cancelChange` | Yes | statusId, effect |
| `onPreStatusRemoved` | `cancelChange` | Yes | statusId, effect |
| `onStatusApplied` | — | No | statusId, effect |
| `onStatusRemoved` | — | No | statusId, effect |

### Combat / Turn Triggers
| Trigger | Key data |
|---|---|
| `onTurnStart` | combat, combatant |
| `onTurnEnd` | combat, combatant |
| `onEnterCombat` | combat |
| `onExitCombat` | combat |

### Activation Triggers
| Trigger | Cancel fn | Sync required | Key data |
|---|---|---|---|
| `onInitActivation` | `cancelAction` | Yes | actionName, item, flowState |
| `onActivation` | — | No | actionName, item, endActivation |
| `onInitCheck` | `cancelCheck` | Yes | flowState |
| `onCheck` | — | No | success, checkType, checkResult |

### Other Triggers
| Trigger | Key data |
|---|---|
| `onDestroyed` | token (fired on deleteToken when struct/stress <= 0) |
| `onDeploy` | deployedTokens, deployable |
| `onUpdate` | changes |

---

## File Responsibilities

### Root scripts/

| File | Lines | Purpose |
|---|---|---|
| `main.js` | ~4500 | Core: hook registration, `handleTrigger`, `checkReactions`, flow step insertion, movement tracking, socket handling, settings, API assembly |
| `reaction-manager.js` | ~2500 | ReactionManager class, ReactionConfig/ReactionEditor/StartupScriptEditor FormApps, `stringToFunction`/`stringToAsyncFunction`, script cache |
| `reactions-registry.js` | ~1500 | Built-in general reactions (Overwatch, Brace, Flight, Lock On, Bolster, Aid, Stabilize, Fragment Signal), external reaction registry |
| `reactions-ui.js` | ~530 | `activateReaction`, `displayReactionPopup`, reaction choice UI |
| `reaction.js` | ~300 | `checkOverwatch`, `displayOverwatch` (legacy overwatch) |
| `reaction-export-import.js` | 78 | Import/export reaction configs |
| `reaction-reset.js` | 67 | Per-turn reaction availability reset |
| `genericBonuses.js` | 2060 | BonusesAPI: accuracy/damage/tag/range injection, immunity/resistance system, global/constant bonuses, flow step functions |
| `flagged-effects.js` | 1278 | EffectsAPI: create/remove/consume ActiveEffects with flags, duration processing, notification batching, effect collapse |
| `effectManager.js` | 1942 | EffectManagerAPI: interactive effect/bonus management dialog (5 tabs) |
| `misc-tools.js` | 1720 | MiscAPI: `executeStatRoll`, `executeSkirmish`, `executeFight`, `executeBasicAttack`, `executeSimpleActivation`, `startChoiceCard`, `knockBackToken`, `openItemBrowserDialog`, `updateTokenSystem`, weapon/item queries |
| `overwatch.js` | 529 | OverwatchAPI: `checkOverwatchCondition`, `isFriendly`, `isHostile`, `canEngage`, `updateAllEngagements`, distance/threat debug |
| `grapple.js` | 548 | Grapple system: state flags, size comparison, immobilized tracking, multi-grappler support |
| `scan.js` | 701 | ScanAPI: `performSystemScan`, `performGMInputScan`, `executeScanOnActivation`, journal creation |
| `downtime.js` | 758 | DowntimeAPI: `executeDowntime` (7 activities, roll tables, journal logging) |
| `reinforcement.js` | 303 | `delayedTokenAppearance`, `initDelayedAppearanceHook`, placeholder tokens |
| `flows.js` | 148 | `registerModuleFlows`, `registerFlowStatePersistence`, `ActiveFlowState`, `forceTechHUDStep` |
| `grid-helpers.js` | ~500 | Hex/square coordinate math, `getMinGridDistance`, `getMovementPathHexes`, `getOccupiedOffsets`, `snapTokenCenter` |
| `terrain-utils.js` | 66 | TerrainAPI: `getTokenCells`, `getMaxGroundHeightUnderToken` |
| `aura.js` | 168 | AurasAPI: `createAura`, `deleteAuras`, `findAura` — wraps grid-aware-auras with lambda callback cache |
| `compendium-tools.js` | 95 | CompendiumToolsAPI: `packMacros`, `executePackMacro` |
| `version-check.js` | 108 | Module update notification |

### scripts/interactive/

| File | Lines | Purpose |
|---|---|---|
| `index.js` | ~70 | Re-exports all interactive modules, assembles `InteractiveAPI` |
| `canvas.js` | ~1725 | `chooseToken`, `placeZone`, `knockBackToken`, `placeToken`, `drawRangeHighlight`, `drawMovementTrace`, `applyKnockbackMoves`, `cancelRulerDrag` |
| `network.js` | ~1133 | Choice cards (`startChoiceCard`, `showUserIdControlledChoiceCard`, `resolveGMChoiceCard`), vote cards (`startVoteCard`), `startWaitCard`, `getTokenOwnerUserId`, `getActiveGMId` |
| `deployables.js` | ~1792 | Deploy lifecycle (`resolveDeployable`, `placeDeployable`, `deployDeployable`), extra actions (`addExtraActions`, `getItemActions`, `removeExtraActions`), activation tracking (`setItemAsActivated`, `getActivatedItems`, `endItemActivation`), `spawnHardCover`, `pickItem`, `findItemByLid`, `reloadOneWeapon`, `rechargeSystem` |
| `combat.js` | ~1391 | `revertMovement`, `clearMovementHistory`, `openChoiceMenu`, `choseMount`, `choseSystem`, `choseTrait`, `chooseInvade`, `executeInvade`, `openThrowMenu` |
| `cards.js` | ~536 | Card stack internals: `_createInfoCard`, `_updateInfoCard`, `_removeInfoCard`, `_queueCard`, pending badge |
| `detail-renderers.js` | ~492 | Popup rendering: `laRenderWeaponBody`, `laRenderActions`, `laRenderTags`, `laDetailPopup`, `laRenderDeployables`, `laRenderCoreSystemBody` |

### scripts/tah/

| File | Lines | Purpose |
|---|---|---|
| `index.js` | ~168 | TAH entry point: 3 settings, 15+ hooks for reactive updates |
| `hud.js` | ~2502 | `LancerHUD` class: cascading 4-column UI, `_buildCategories`, `bind(tokens)`, multi-token support |
| `item-helpers.js` | ~345 | `laHudItemChildren`, `getItemStatus`, `getActivationIcon`, `laHudRenderIcon`, `appendItemPips` |
| `search.js` | ~109 | `collectSearchResults`, `openSearchResults` — cross-category search |
| `stats-bar.js` | ~137 | `buildStatsHtml(actor)` — HP/heat/structure/pips/overcharge/reaction/movement display |
| `status-panel.js` | ~589 | `StatusPanel` class: wide status/effects/bonuses panel with custom statuses |
| `hover.js` | ~256 | `onHudRowHover` — range preview aura, weapon reach display |
| `hud-popups.js` | ~112 | `showPopupAt`, `toggleDetailPopup` — popup positioning + toggle helpers |

### scripts/alt-struct/

| File | Lines | Purpose |
|---|---|---|
| `index.js` | ~205 | `registerAltStructFlowSteps`, `initAltStructReady`, rollback mechanism |
| `structure.js` | ~1321 | Alt structure roll table (dNd6kl1), hull checks, direct/crushing hit flows, system trauma, tear-off |
| `stress.js` | ~551 | Alt stress roll table, engineering checks, meltdown flows (countdown, critical) |

### scripts/typing/

| File | Lines | Purpose |
|---|---|---|
| `types.d.ts` | 783 | Full type definitions: TriggerType, all TriggerData interfaces, ReactionConfig, LancerAutomationsAPI |
| `external-globals.d.ts` | ~266 | Foundry/Lancer global augmentations (Sequencer, FlagConfig, libWrapper, etc.) |
| `lancer-system.d.ts` | ~196 | Lancer system type augmentations (LancerActorSystem, LancerLoadout, LancerAction, etc.) |

### startups/

| File | Lines | Purpose |
|---|---|---|
| `itemActivations.js` | 2626 | All built-in NPC feature automations (30+ items). See itemActivations.js Breakdown section |

### tests/

| File | Lines | Purpose |
|---|---|---|
| `card-stack.js` | ~100 | Card stack tests: `orBasic()`, `andBasic()`. Run via `api.tests.cardStack.runAll()` |

---

## Complete Settings List

### Core Settings (main.js)

| Key | Scope | Type | Default | Description |
|---|---|---|---|---|
| `reactionNotificationMode` | world | String | `"both"` | Who sees activation popups: `"both"`, `"gm"`, `"owner"` |
| `consumeReaction` | world | Boolean | `true` | Auto-spend reaction on activation |
| `showBonusHudButton` | world | Boolean | `true` | Show token HUD bonus management button |
| `additionalStatuses` | world | Boolean | `true` | Register extra statuses (requires reload) |
| `enableKnockbackFlow` | world | Boolean | `false` | Automate knockback on hit |
| `enableThrowFlow` | world | Boolean | `false` | Throw choice for thrown weapons |
| `statRollTargeting` | world | Boolean | `false` | Enable stat roll target selection |
| `treatGenericPrintAsActivation` | world | Boolean | `false` | Treat generic prints as activations |
| `enablePathHexCalculation` | world | Boolean | `false` | Path hex calculation for movement |
| `experimentalBoostDetection` | world | Boolean | `false` | Boost detection from movement cost |
| `enableMovementCapDetection` | world | Boolean | `false` | Movement cap tracking in combat |
| `showDeployableLines` | world | Boolean | `false` | Show deployable connection lines on hover |
| `enableAltStruct` | world | Boolean | `false` | Alt structure/stress rules (requires reload) |
| `dragVisionMultiplier` | world | Number | `1` | Vision radius multiplier during drag (0-1) |
| `linkManualDeploy` | world | Boolean | `false` | Auto-link manually placed deployables |

### Debug Settings

| Key | Scope | Type | Default | Description |
|---|---|---|---|---|
| `debugBoostDetection` | world | Boolean | `false` | Log boost detection details |
| `debugPathHexCalculation` | world | Boolean | `false` | Log path hex calculation |
| `debugOutOfCombat` | world | Boolean | `false` | Warn on out-of-combat triggers |

### Reaction Data Settings (reaction-manager.js)

| Key | Type | Description |
|---|---|---|
| `customReactions` | Object | Custom item-based activations storage |
| `generalReactions` | Object | General activations storage |
| `activationFolders` | Array | Folder organization for activations |
| `startupScripts` | Array | User startup scripts |
| `enableLaSossisItems` | Boolean | Special items toggle |

### TAH Settings (tah/index.js)

| Key | Scope | Type | Default | Description |
|---|---|---|---|---|
| `tahEnabled` | client | Boolean | `false` | Enable Token Action HUD (beta) |
| `tah.clickToOpen` | client | Boolean | `false` | Open on click instead of hover |
| `tah.hoverCloseDelay` | client | Number | `0.5` | Seconds before HUD collapses |

### Settings Menus

| Key | FormApplication | Description |
|---|---|---|
| `reactionConfig` | ReactionConfig | Activation Manager UI |
| `resetSettings` | ReactionReset | Reset module settings |
| `exportActivations` | ReactionExport | Export activations to JSON |
| `importActivations` | ReactionImport | Import activations from JSON |

### Internal

| Key | Description |
|---|---|
| `lastNotifiedVersion` | Tracks last shown update notification |

---

## Complete Hooks List

### Hooks this module LISTENS to

**main.js:**
| Hook | Line | Purpose |
|---|---|---|
| `init` | 3240 | Register settings, keybindings, libWrapper wraps |
| `lancer.registerFlows` | 3332 | Insert module flow steps |
| `lancer.statusesReady` | 3540 | Register additional statuses |
| `ready` | 3736 | Initialize API, startup scripts, module integrations |
| `canvasReady` | 3450 | Set up deployable connection lines graphic |
| `hoverToken` | 3464 | Draw deployable connection lines on hover |
| `renderChatMessage` | 3784 | Bind flow state interceptors, damage button handlers |
| `renderTokenHUD` | 3887 | Add bonus management button to token HUD |
| `renderSettings` | 4237 | Add module button to settings sidebar |
| `combatTurnChange` | 3942 | Handle turn start/end triggers, movement reset |
| `createCombatant` | 3965 | Run onInit reactions for new combatants |
| `deleteCombatant` | 3974 | Run onExitCombat triggers |
| `deleteCombat` | 3983 | Run onExitCombat for all combatants |
| `updateCombat` | 3994 | Effect duration ticking |
| `preCreateActiveEffect` | 3999 | Check effect immunities, prevent blocked effects |
| `preDeleteActiveEffect` | 4067 | Handle pre-status-removed triggers |
| `createActiveEffect` | 4102 | Handle onStatusApplied triggers |
| `deleteActiveEffect` | 4113 | Handle onStatusRemoved triggers, clear caches |
| `updateActiveEffect` | 4135 | Handle effect stack changes |
| `preDeleteToken` | 4171 | Handle onDestroyed trigger |
| `createToken` | 4186 | Run onInit for new tokens, link deployables |
| `updateActor` | 4198 | Clear reaction item caches, handle HP changes |
| `preUpdateToken` | 4262 | Movement interception (`handleTokenMove`) |
| `updateToken` | 4472 | Post-move triggers (onMove, overwatch, engagement) |
| `createItem` | 90 | Clear reaction item caches, check onInit |
| `lancer-automations.clearCaches` | 85 | Clear cached general reactions |
| `lancer-automations.runOnMessage` | 308 | Execute onMessage reactions |

**tah/index.js:**
| Hook | Line | Purpose |
|---|---|---|
| `init` | 22 | Register TAH settings |
| `controlToken` | 57 | Show/hide HUD on token select |
| `updateActor` | 72 | Update stats bar in-place |
| `updateItem` / `createItem` / `deleteItem` | 82-96 | Schedule full HUD refresh |
| `createActiveEffect` / `deleteActiveEffect` | 105-112 | Schedule HUD refresh |
| `updateToken` | 121 | Schedule HUD refresh |
| `updateCombat` / `updateCombatant` | 132-139 | Schedule HUD refresh |
| `createCombat` / `deleteCombat` | 146-153 | Schedule HUD refresh |
| `forceUpdateTokenActionHud` | 162 | Force immediate HUD refresh |

**Other files:**
| Hook | File | Purpose |
|---|---|---|
| `lancer-automations.ready` | grapple.js:193 | Register grapple reactions |
| `deleteActiveEffect` | genericBonuses.js:1749 | Clean up linked bonuses on effect delete |
| `updateCombat` | reinforcement.js:143 | Auto-show reinforcements at target round |
| `lancer-automations.clearCaches` | misc-tools.js:892 | Clear action items cache |
| `createToken` | tah/hover.js:228 | Pre-cache deployable info for new tokens |

### Hooks this module FIRES

| Hook | Purpose |
|---|---|
| `lancer-automations.ready` | Fired after API is assembled. Passes `api` object. Used by grapple.js. |
| `lancer-automations.clearCaches` | Clears all reaction caches. Fired on item/actor changes. |
| `forceUpdateTokenActionHud` | Forces TAH refresh. |

---

## Subsystem Deep Dives

### Interactive Subsystem

**canvas.js** — All canvas-level interactions:
- `chooseToken(casterToken, options)` — Interactive token picker with range highlight, filter, count, includeSelf, includeHidden, title/description/icon. Returns array of tokens.
- `placeZone(casterToken, options)` — Place MeasuredTemplates (Blast/Burst/Cone/Line) with range validation, fill color, difficult terrain, dangerous zones. Returns template data.
- `knockBackToken(tokens, distance, options)` — Interactive knockback destination picker per token with elevationruler integration.
- `placeToken(options)` — Spawn actor tokens on canvas (single/multi actor).
- `drawRangeHighlight(casterToken, range, color, alpha, includeSelf)` — Grid-aware range highlight (hex or square).
- `drawMovementTrace(token, originalEndPos, newEndPos)` — Visualize token movement path.

**network.js** — Multiplayer card system:
- `startChoiceCard(options)` — Modal choice card: `{ title, description, choices: [{text, icon, callback}], mode: "or"|"and", userIdControl, item, originToken, relatedToken }`. Returns `{ choiceIdx, responderIds }`.
- `showUserIdControlledChoiceCard(options)` — Route choice to specific user via socket.
- `startVoteCard(options)` — Multi-user voting card (majority/unanimous).
- `startWaitCard(options)` — Non-interactive waiting indicator. Returns `{ remove() }`.
- `getTokenOwnerUserId(token)` — Get user ID(s) that own a token.
- `getActiveGMId()` — Get active GM user ID.

**deployables.js** — Deploy lifecycle + extra actions:
- Deploy lifecycle: `resolveDeployable(lid, actor)` -> `placeDeployable(options)` -> `deployDeployable(actor, lid, parentItem, consumeUse)`
- Extra actions: `addExtraActions(target, actions)`, `getItemActions(item)`, `getActorActions(tokenOrActor)`, `removeExtraActions(target, filter)`
- Activation tracking: `setItemAsActivated(item, token, endAction, endActionDescription)`, `getActivatedItems(token)`, `endItemActivation(item, token)`
- Utility: `spawnHardCover(originToken, options)`, `pickItem(items, options)`, `findItemByLid(actorOrToken, lid)`, `reloadOneWeapon(actorOrToken)`, `rechargeSystem(actorOrToken, name)`, `getWeapons(entity)`, `addExtraDeploymentLids(item, lids)`

**combat.js** — Movement + action selection:
- `revertMovement(token, destination)` — Undo token movement with elevationruler integration
- `clearMovementHistory(tokens, revert)` — Clear movement history flags
- `choseMount(actorOrToken, numberToChoose, filterPredicate, allowedMountTypes, title, selectionValidator)` — Interactive mount picker
- `choseSystem(actorOrToken, ...)` / `choseTrait(actorOrToken, ...)` — System/trait pickers
- `chooseInvade(actorOrToken)` / `executeInvade(actorOrToken, bypassChoice)` — Invade target + execution

### Movement Tracking System
Located in `main.js` lines ~1630-1760. Token flags: `lancer-automations.moveHistory`, `lancer-automations.movementCap`.

| Function | Purpose |
|---|---|
| `clearMoveData(token)` | Clear movement history |
| `undoMoveData(token)` | Undo last move entry |
| `getCumulativeMoveData(token)` | Total move distance (all types) |
| `getIntentionalMoveData(token)` | Only voluntary move distance |
| `getMovementHistory(token)` | Returns `MovementHistoryResult` (total, intentional, unintentional, boost count, cap) |
| `getMovementCap(token)` | Remaining movement allowance |
| `initMovementCap(token)` | Set cap from actor speed |
| `increaseMovementCap(token, amount)` | Add bonus movement |

Boost detection: when `experimentalBoostDetection` is enabled, tracks cumulative movement cost vs speed to auto-detect boost actions.

### Engagement System
Located in `overwatch.js`:
- `canEngage(token1, token2)` — Hostile + adjacent (<=1 space) + non-deployable + non-dead + no disqualifying statuses (hidden, disengage, intangible)
- `updateAllEngagements()` — Auto-update ENGAGED status on all tokens. Called from `updateToken` hook.
- `isFriendly(token1, token2)` / `isHostile(reactor, mover)` — Uses token-factions API when available, falls back to `CONST.TOKEN_DISPOSITIONS`.

### Grapple System
Located in `grapple.js`. Entry point: standalone esmodule. Registers via `Hooks.on('lancer-automations.ready')`.

Token flags: `lancer-automations.grappleState`:
- Grappled token: `{ grapplerIds: string[], immobilizedSide: "grappled"|"grapplers"|null }`
- Grappler token: `{ grappledIds: string[] }`

Size-based immobilization: larger side immobilizes smaller; equal triggers contested HULL check. Multi-grappler support. Knockback breaks grapple. Grapple fails if target immune to 'grappled'.

Three registered reactions: "Grapple" (choice card with Grapple/End/Break Free), "End Grapple" (free action), "Break Free" (quick action contested HULL).

### Alt-Struct Subsystem
Setting: `enableAltStruct` (world, requires reload). Mutual exclusion with standalone `lancer-alt-structure` module.

Registration: `registerAltStructFlowSteps` called during `lancer.registerFlows`, `initAltStructReady` during `ready`.
Rollback: saves original flow steps in `_savedFlowSteps`, restores if setting disabled or conflict detected.

9 new flows: SimulatedStructureFlow, DirectHitHullCheckFlow, CrushingHitHullCheckFlow, TearOffDirectHitFlow, TearOffCrushingHitFlow, StressEngineeringCheckFlow, MeltdownFlow, CriticalMeltdownFlow, secondaryStructureCrushingHit.

Structure outcomes (dNd6kl1): 0=Crushing hit, 1=Direct hit, 2-4=System trauma, 5-6=Glancing blow.
Stress outcomes (dNd6kl1): 0=Meltdown countdown, 1=Power failure (ENG check), 2-4=Slowed/Throttled, 5-6=Impaired.

### Scan System
Located in `scan.js`:
- `performSystemScan(target, createJournal, customName)` — Reveals NPC stats: HASE table, HP/heat/armor/speed, weapons, systems, traits, core bonuses. Creates journal in "SCAN Database" folder.
- `performGMInputScan(targets, scanTitle, requestingUserName)` — GM provides hidden/generic info via dialog.
- `executeScanOnActivation(reactorToken)` — Triggered from activation flow with Sequencer SFX.

### Downtime System
Located in `downtime.js`. `executeDowntime()` opens a full downtime dialog with 7 activities:
- Rollable: Power At A Cost, Get Focused, Buy Some Time, Gather Information
- Non-rollable: Get A Damn Drink, Build Bonds, Mend Wounds
- Union calendar timestamps, journal logging to "Downtime Journal" folder.

### Reinforcement System
Located in `reinforcement.js`:
- `delayedTokenAppearance()` — GM selects tokens, sets rounds delay. Hides originals, spawns "Size X" placeholders with "[N]" countdown names.
- `initDelayedAppearanceHook()` — `updateCombat` hook: at target round, GM picks which NPCs appear. Sequencer effects on appearance.

---

## Bonus System Deep Reference
Source: `genericBonuses.js` (2060 lines).

### Bonus Types
| Type | Purpose |
|---|---|
| `accuracy` | +/- accuracy on rolls |
| `difficulty` | +/- difficulty on attacker rolls against target |
| `damage` | +/- damage of specific type |
| `stat` | Direct stat modification (hp.value, heat.value, overshield.value, burn, repairs.value) |
| `immunity` | Block damage types, effects, crits, hits, misses |
| `resistance` | Halve specific damage types |
| `tag` | Add/remove/change weapon tags |
| `range` | Add/change weapon range |
| `multi` | Container for multiple sub-bonuses |
| `target_modifier` | Inject target-level properties (invisible, cover, AP, half damage, etc.) onto attack/damage targets |

### Storage
- `global_bonuses` (actor flag): tied to effects, auto-removed when effect expires. Created via `addGlobalBonus()`.
- `constant_bonuses` (actor flag): persist until explicitly removed via `removeConstantBonus()`. Created via `addConstantBonus()`.

### Bonus Data Shape
```js
{
    id: string,              // Unique identifier
    name: string,            // Display name
    type: string,            // See types above
    val: number|string,      // Value
    condition?: string|fn,   // Lambda function support (@@fn: prefix)
    applyTo?: string,        // "ally", "enemy", "self"
    consumedOn?: string,     // Consumption trigger
    itemLid?: string,        // Filter: source item LID
    itemId?: string,         // Filter: source item ID
    rollTypes?: string[],    // Flow types: "attack", "tech_attack", "damage", etc.
    uses?: number,           // Uses (linked to statuscounter)
    damageTypes?: string[],  // For immunity/resistance
    effects?: string[],      // For effect immunity
    subtype?: string,        // For immunity: "effect"|"damage"|"resistance"|"crit"|"hit"|"miss"
                             // For target_modifier: "invisible"|"no_cover"|"soft_cover"|"hard_cover"|"ap"|"half_damage"|"paracausal"|"crit"|"hit"|"miss"
    subtype?: string,        // "effect", "damage", "resistance", "crit", "hit", "miss", "elevation"
    tagId?: string,          // For tag type
    tagMode?: string,        // "add" | "override" | "remove"
    rangeType?: string,      // For range type
    rangeMode?: string,      // "add" | "override" | "change"
}
```

### addGlobalBonus Options
```js
await api.addGlobalBonus(actor, bonusData, {
    duration: "end" | "start" | "unlimited" | "indefinite" | "1 Round",
    origin: token,           // Token that applied the bonus
    consumption: {           // Auto-consume on trigger
        trigger: "onHit",
        itemLid: "...",
        grouped: true
    }
});
```

### Flow Injection
`createGenericBonusStep(rollType)` factory creates the 5 generic flow steps. `flattenBonuses` + `isBonusApplicable` filter which bonuses apply to a given roll. `applyTagBonus` mutates weapon tags. `mutateRangeWithBonus` modifies range arrays.

---

## Effect System Deep Reference
Source: `flagged-effects.js` (1278 lines).

### Core Functions
| Function | Purpose |
|---|---|
| `setEffect(targetID, effectOrData, duration, note, originID, extraOptions)` | Create/stack flagged active effect with duration tracking |
| `applyEffectsToTokens({ tokens, effectNames, note, duration }, extraFlags)` | Batch apply to multiple tokens with notifications |
| `removeEffectsByNameFromTokens({ tokens, effectNames, extraFlags })` | Batch remove with flag matching |
| `findEffectOnToken(token, filterFn)` | Find effect matching predicate |
| `checkEffectImmunities(actor, effectName)` | Check for immunity (returns source names array) |
| `triggerEffectImmunity(token, effectNames, source, notify)` | Remove effects if immunity present |
| `deleteAllEffects(tokens)` | Remove all flagged effects |
| `consumeEffectCharge(effect)` | Decrement stack/remove if exhausted |

### Duration System
```js
{
    label: "start" | "end" | "round" | "unlimited" | "indefinite",
    turns: number|null,      // Countdown turns
    rounds: number|null,     // Round tracking
    overrideTurnOriginId?: string  // Track from a different token's turn
}
```
Duration ticking via `handleEffectDurationTick` on `updateCombat` hook.

### Effect Flags
All effects store metadata in `flags['lancer-automations']`: effect name, duration, note, originID, consumption config, linkedBonusId, suppressSourceId, stack count, etc.

### Notification Batching
100ms debounce groups multiple effect changes into single UI notification per token.

### Effect Collapse
libWrapper on `Token._refreshEffects`: stacks identical same-name effect icons into single icon with count badge.

---

## TAH System Architecture

### Overview
A floating HUD anchored at fixed screen position. Shows a cascading menu of up to 4 columns. The leftmost column (c1) is in-flow; c2/c3/c4 are `position:absolute` and slide in/out.

### Category shape
```js
{ label, colLabel, getItems: () => Item[], isStatusPanel?: true }
```

### Item shape
```js
{
    label,          // HTML string (can contain <s>, <b>, etc.)
    icon?,          // img src
    badge?,         // small right-side text
    badgeColor?,
    highlightBg?,           // custom background hex
    highlightBorderColor?,
    isSectionLabel?,        // if true, non-clickable section header
    childColLabel?,         // label for the child column that opens
    getChildren?(): Item[], // opens c3 or c4
    onClick?(): void,
    onRightClick?(rowEl): void,
    hoverData?,             // passed to onHudRowHover
    keepOpen?,              // don't close columns on click
    refreshCol4?: () => Item[], // re-render c4 with new items on change
}
```

### Column architecture
- **c1**: in-flow, fixed width 180px; contains token title, stats bar, MENU label, search bar, category rows
- **c2/c3/c4**: `position:absolute`, cascade right; hidden when not in use
- `closeCol(col, duration)` — module-level helper, animates opacity+marginLeft to 0 then hides
- `_openChildCol(parentCol, childCol, item, row)` — positions and animates a child column open

### Multi-token support
`bind(tokens)` accepts array. `_tokens` stores all, `_token` getter returns first. Category builders access `_token` for primary display.

### Collapse system
- `_leaveTimer` — `setTimeout` handle local to `_render()`
- `_scheduleCollapse` / `_cancelCollapse` — closures created inside `_render()`, stored on instance for use by StatusPanel and popups
- Collapse fires after configurable delay (default 0.5s) after last mouseleave
- `_searchActive` — blocks collapse when search results are visible

### Refresh system
- `scheduleRefresh(delay=100)` — debounced full re-render
- `updateStatsInPlace()` — patches only stats bar without re-rendering columns
- 15+ hooks in `tah/index.js` handle reactive updates

### StatusPanel
`StatusPanel` (in `status-panel.js`) manages the wide statuses panel. Instance created in `_render()` after `_scheduleCollapse` is defined. Lifetime matches HUD render cycle. Features: status toggle, bonus management, custom status support.

### Popup system
`toggleDetailPopup({ cssClass, dataKey, dataValue, title, subtitle, bodyHtml, iconType, row, showPopupAt })` — handles the open-if-closed / close-if-same-open toggle pattern. `showPopupAt(popup, anchorEl, { cancelCollapse, scheduleCollapse })` positions with invisible bridge div to prevent mouseleave gaps. Automation indicator (lightning bolt) shows when item has registered reactions.

### Range preview on hover
`onHudRowHover` in `hover.js` creates temporary in-memory auras via grid-aware-auras API to preview weapon reach, sensor range, and deployable placement range.

---

## itemActivations.js Breakdown

All built-in NPC feature automations in `startups/itemActivations.js` (2626 lines). Registered via `api.registerDefaultItemReactions()` and `api.registerDefaultGeneralReactions()`.

| LID(s) | Name | Triggers | Pattern |
|---|---|---|---|
| `npcf_suppress_archer` + rebake | Suppress (Archer) | onActivation, onDamage, onStatusApplied, onDestroyed | Multi-trigger, source-tracked extraFlags, chooseToken + apply effects |
| `npcf_moving_target_sniper` | Moving Target (Sniper) | onPreMove | Blocking cancelTriggeredMove + sendMessageToReactor/onMessage for remote attack |
| `npcf_moving_target_archer` + rebake | Moving Target (Archer) | onPreMove + onActivation | Blocking cancel on suppressed target, then executeSkirmish |
| `npcf_sealant_gun_support` + rebake | Sealant Gun | onActivation | chooseToken, friendly=clear burn+slow, hostile=AGI save+slow+placeZone |
| `npcf_veterancy_veteran` + rebake | Veterancy | onEnterCombat + onExitCombat | addConstantBonus accuracy, choice of HULL/AGI/SYS/ENG |
| `npcf_restock_drone_support` + rebake | Restock Drone | onDeploy + onInit | createAura with lambda callback (heal HP or reload on ENTER) |
| 11x insulated LIDs | Insulated | onInit | addConstantBonus multi (burn effect + burn damage immunity) |
| `npcf_regenerative_shielding_aegis` + rebake | Regenerative Shielding | onInit | addConstantBonus multi (slow+impaired immunity + crit immunity) |
| `npcf_defense_net_aegis` | Defense Net | onActivation + onStatusApplied | Factory `buildDefenseNetReaction(3)`: createAura with bonuses, immobilized self, teardown on stun/jam |
| `npc-rebake_npcf_defense_net_aegis` | Defense Net (Rebake) | + onHeat + onTechMiss | Factory `buildDefenseNetReaction(2, true)`: + Ring of Fire heat/shredded, + tech miss heat damage |
| `npcf_snipers_mark_sniper` | Sniper's Mark | onActivation + onStatusApplied/Removed | chooseToken range 25, toggle mark, addExtraActions "Fall Prone" |
| `npcf_anti_materiel_rifle_sniper` | Anti-Materiel Rifle | onHit | Check marked+exposed, sendMessageToReactor for GM confirm, -1 structure |
| `ubrg_npcf_battlefield_diagnostics_armourer` | Battlefield Diagnostics | onTechHit | Choice card: reload, remove ordnance, add AP/Seeking/Reliable/Knockback tags |
| `npcf_mech_splint_triage_maxt` | Mech Splint Triage | onActivation | chooseToken adjacent ally, pick condition to clear |
| `Maneuver` | Maneuver | onDamage | Reliable damage miss reaction (activationType: "flow") |
| `fast_vehicle` | Fast Vehicle | onCheck + onActivation(Boost) | Successful check reaction + auto soft cover on boost |
| `nrfaw-npc_..._smoke_grenade_strider` | Smoke Grenade | onActivation | placeZone Blast 1 with soft cover |
| `nrfaw-npc_carrier_SmokeLaunchers` | Smoke Launchers | onActivation + onTurnStart | placeZone Blast 2, auto-delete on turn start |
| `ubrg_npcf_scorcher_missile_rack_avenger` | Scorcher Missile Rack | onAttack | placeZone single hex dangerous (5 burn) |
| `npc_carrier_RemoteMachineGun` | Remote Machine Gun | onHit + onDestroyed + onMove | Apply impaired on hit, damage on move while impaired, cleanup on destroy |
| `npcf_dispersal_shield_priest` | Dispersal Shield | onActivation | chooseToken in sensors, roll 1d3 Resist All charges with consumption |
| `npc_sergeant_SquadLeader` | Squad Leader | onActivation + onInitCheck/onCheck | addGlobalBonus accuracy to ally, inject difficulty to opponents |
| `moff_triangulation_ping_sysadmin` | Triangulation Ping | onTechAttack | SYS save, apply lockon on fail, per-round per-target tracking |
| `npcf_deployable_turret_engineer` + rebake | Deployable Turret | onInit | addExtraDeploymentLids for tier-specific turrets |
| `npcf_marker_rifle_scout` | Marker Rifle | onHit + onInitActivation + onPreStatusApplied | Apply lockon+shredded, cancel Hide if marked, cancel invisibility if marked |
| `npc-rebake_npcf_marker_rifle_scout` | Marker Rifle (Rebake) | onHit | Simplified: apply lockon+shredded |
| `nrfaw-npc_..._duck_strider` | Duck (Marksman Kit) | onHit | Long range (>8) reaction: convert hit to miss + Resist All |
| `npcf_deadmetal_rounds_sniper` | Deadmetal Rounds | onActivation | addGlobalBonus: change Anti-Materiel Rifle range to Line 20, consume on attack |
| `npcf_lightning_reflexes_veteran` + rebake | Lightning Reflexes | onAttack | Heavy+ weapon: sendMessageToReactor, remote player rolls 1d6, 5+ = hit immunity |
| `npcf_feign_death_veteran` + rebake | Feign Death | onDestroyed | GM choice: clone token hidden with feign_death flag, 1 HP |
| 5x climber LIDs | Climber | onInit | addConstantBonus elevation immunity |
| `nrfaw-npc_..._cqb_training_strider` | CQB Training | onInit | slowed + grappled effect immunity |
| 4x limitless LIDs | Limitless (Overcharge) | onInit | addExtraActions "Overcharge (NPC)" protocol |
| `cap_npc_architect_slurry_cannon` | Slurry Cannon | onAttack + onTurnStart | spawnHardCover + placeZone difficult terrain, auto-delete on turn start |
| `cap_npc_architect_citadel_combat_terraformer` | Citadel Terraformer | 7 sub-reactions | onInit (4 sub-actions) + Print (hard cover) + Rift (Line 5 delayed collapse) + Sharpen (Blast 1 diff terrain + prone damage) + Tremor (Hull saves + prone + AP to deployables) + onTurnStart (rift collapse) |
| `Fall Prone (Sniper's Mark)` | Fall Prone | onActivation (general) | Apply prone — general reaction, not item-based |

---

## Packs Source Macros

33 macros in `packs_source/macros/`, each with `.js` (command) + `.json` (metadata):

| Macro | Purpose |
|---|---|
| Aid | Aid action |
| Barrage | Barrage attack action |
| Bolster | Bolster action |
| BootUp | Boot Up from shutdown |
| Brace | Brace reaction |
| DeployItem | Deploy system item |
| Disengage | Disengage action |
| Dismount | Dismount from mech |
| Downtime | Open downtime dialog |
| Eject | Emergency eject |
| EndActiveItem | End active item activation |
| FragSignal | Fragment Signal action |
| Grapple | Grapple action |
| Handle | Handle deployable action |
| Hide | Hide action |
| Interact | Interact action |
| Invade | Invade tech action |
| Knockback | Manual knockback |
| LockOn | Lock On action |
| OpenChoiceMenu | Open main action choice menu |
| Overwatch | Trigger overwatch check |
| PickupWeapon | Pick up thrown weapon |
| Ram | Ram action |
| ReactorExplosion | Reactor explosion |
| ReactorMeltdown | Reactor meltdown |
| Reinforcement | Delayed reinforcement setup |
| ReloadOneWeapon | Reload a loading weapon |
| Scan | Scan action |
| Search | Search action |
| ShutDown | Shut down mech |
| Skirmish | Skirmish attack action |
| Squeeze | Squeeze through tight space |
| Suicide | Self-destruct |
| ThrowWeapon | Throw weapon action |

---

## External Dependencies

### Required

| Module | Purpose |
|---|---|
| `lancer` (system) | Lancer TTRPG system — flows, items, actors, combat |
| `lancer-style-library` | CSS classes: `lancer-dialog-base`, `lancer-no-title`, `lancer-dialog-header` |
| `temporary-custom-statuses` | Custom status/condition effect creation and management |
| `lib-wrapper` | 6 wrapper registrations: Token, Item, Macros, MovePenalty interception |
| `socketlib` | Multiplayer socket coordination |
| `tokenmagic` | Visual token effects (TokenMagic filters) |
| `sequencer` | SFX sequencing (reinforcement appearances, scan effects) |

### Optional / Recommended

| Module | Purpose |
|---|---|
| `_CodeMirror` | In-app code editor UI for reaction scripts and startup scripts |
| `templatemacro` | Template zone macros: `findContained(templateDoc)`, dangerous terrain wrapper |
| `elevationruler` | Movement cost calculation, terrain/climbing penalty interception, ruler history |
| `token-factions` | `getDisposition` API for friendly/hostile checks, `retrieveBorderFactionsColorFromToken` for aura coloring |
| `grid-aware-auras` | `createAura`/`deleteAuras`/`findAura` for NPC aura effects (Defense Net, Restock Drone, hover preview) |

---

## Module API Reference

Accessed as `game.modules.get('lancer-automations').api` or as the `api` parameter in callbacks. Full documentation in `doc/API_REFERENCE.md` (split across 5 files in `doc/`).

| Sub-API | Source | Key functions |
|---|---|---|
| OverwatchAPI | overwatch.js | `checkOverwatchCondition`, `isHostile`, `isFriendly`, `getTokenDistance`, `canEngage`, `updateAllEngagements` |
| ReactionsAPI | reactions-registry.js | `registerExternalItemReactions`, `registerExternalGeneralReactions`, `registerDefaultItemReactions`, `registerDefaultGeneralReactions` |
| EffectsAPI | flagged-effects.js | `applyEffectsToTokens`, `removeEffectsByNameFromTokens`, `findEffectOnToken`, `getAllEffects`, `deleteEffect`, `consumeEffectCharge`, `checkEffectImmunities` |
| BonusesAPI | genericBonuses.js | `addGlobalBonus`, `removeGlobalBonus`, `addConstantBonus`, `removeConstantBonus`, `getGlobalBonuses`, `getConstantBonuses`, `checkEffectImmunities`, `hasCritImmunity`, `hasHitImmunity` |
| InteractiveAPI | interactive/index.js | `chooseToken`, `placeZone`, `knockBackToken`, `startChoiceCard`, `startVoteCard`, `placeToken`, `spawnHardCover`, `revertMovement`, `choseMount`, `choseSystem`, `choseTrait`, `deployWeaponToken`, `placeDeployable`, `addExtraActions`, `getItemActions`, `setItemAsActivated`, `pickItem`, `findItemByLid`, `reloadOneWeapon`, `getTokenOwnerUserId` + 30 more |
| MiscAPI | misc-tools.js | `executeStatRoll`, `executeSkirmish`, `executeFight`, `executeBasicAttack`, `executeSimpleActivation`, `hasReactionAvailable`, `getActorMaxThreat`, `openItemBrowserDialog`, `updateTokenSystem`, `executeFall`, `executeStandingUp` |
| CompendiumToolsAPI | compendium-tools.js | `packMacros`, `executePackMacro` |
| EffectManagerAPI | effectManager.js | `executeEffectManager` |
| TerrainAPI | terrain-utils.js | `getTokenCells`, `getMaxGroundHeightUnderToken` |
| DowntimeAPI | downtime.js | `executeDowntime` |
| ScanAPI | scan.js | `executeScanOnActivation` |
| AurasAPI | aura.js | `createAura`, `deleteAuras`, `findAura` |
| main.js internals | main.js | `clearMoveData`, `getMovementHistory`, `getMovementCap`, `handleTrigger`, `processEffectConsumption`, `registerUserHelper`, `getUserHelper`, `injectBonusToFlowState`, `executeDamageRoll` |

### Extra Actions helpers (`InteractiveAPI` / `deployables.js`)

| Function | Signature | Notes |
|---|---|---|
| `addExtraActions` | `(target, actions)` | Adds action object(s) to an item, token, or actor via flags. Items store on the item; token/actor stores on the actor. |
| `getItemActions` | `(item)` | Returns `system.actions` merged with the item's `extraActions` flag. |
| `getActorActions` | `(tokenOrActor)` | Returns extra actions stored on an actor/token via `addExtraActions`. |
| `removeExtraActions` | `(target, filter?)` | Removes extra actions from an item, token, or actor. `filter` = predicate, name string, or array of names. No filter = clears all. |

---

## Key Patterns & Conventions

### Globals
Files use `/*global game, canvas, ui, ChatMessage, ... */` JSDoc comments to declare Foundry globals for ESLint. Do not remove these.

### Evaluate must be synchronous for blocking triggers
Triggers `onPreMove`, `onInitAttack`, `onInitTechAttack`, `onInitCheck`, `onInitActivation`, `onPreStatusApplied`, `onPreStatusRemoved` use cancel functions that only work synchronously. Async `evaluate()` with these triggers logs a warning and the cancel is ignored.

### `forceSynchronous` flag
Set on a ReactionConfig to suppress the async-evaluate warning when the user intentionally accepts the limitation.

### `onlyOnSourceMatch` flag
When `true`, the reaction only fires if the triggering item's LID matches the reaction's registered LID. Critical for activation-based reactions.

### `reactionPath` field
Matches specific sub-actions: e.g. `"extraActions.Print"` for citadel terraformer sub-actions.

### Activation modes
- `"instead"` — replace the flow entirely (most common for custom code)
- `"before"` — run before the flow
- `"after"` — run after the flow
- `"flow"` — run the item's normal activation flow

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

### Disposition filter
`checkDispositionFilter` in main.js checks reaction disposition settings (friendly/neutral/hostile/secret) against token disposition. Uses token-factions API when available, falls back to `document.disposition`.

---

## Immunity System — Subtypes Reference

**Critical rule: only the subtypes listed below are checked by the engine. Do NOT invent new subtypes.**

| Subtype | Checked by | How to grant | Purpose |
|---|---|---|---|
| `"effect"` | `checkEffectImmunities(actor, name)` | `addConstantBonus` or `addGlobalBonus` with `effects: ["status-name"]` | Blocks a named status effect from being applied to the token |
| `"damage"` | `applyDamageImmunities(actor, damages)` | bonus with `damageTypes: ["Kinetic"]` | Blocks specific damage types |
| `"resistance"` | `checkDamageResistances(actor, type)` | bonus with `damageTypes: [...]` | Halves specific damage types |
| `"crit"` | `hasCritImmunity(actor)` | bonus (no extra fields needed) | Prevents crits |
| `"hit"` | `hasHitImmunity(actor)` | bonus (no extra fields needed) | Makes attacks auto-miss |
| `"miss"` | `hasMissImmunity(actor)` | bonus (no extra fields needed) | Makes attacks auto-hit |
| `"elevation"` | `getImmunityBonuses(actor, "elevation")` | bonus (no extra fields needed) | Custom: skips elevation movement penalty (checked in `main.js` libWrapper) |

### Granting effect immunity — correct pattern
```js
// Block the "slowed" status from ever being applied:
await api.addConstantBonus(token.actor, {
    id: `my-feature-slowed-${item.id}`,
    name: "My Feature",
    type: "immunity",
    subtype: "effect",
    effects: ["slowed"]        // <-- array of status IDs/names to block
});

// Block the "grappled" status:
await api.addConstantBonus(token.actor, {
    id: `my-feature-grappled-${item.id}`,
    name: "My Feature",
    type: "immunity",
    subtype: "effect",
    effects: ["grappled"]
});
```

### Checking effect immunity in custom code
```js
// Returns array of source names -- non-empty means immune:
const sources = api.checkEffectImmunities(target.actor, 'grappled');
if (sources.length > 0) {
    ui.notifications.warn(`${target.name} is immune to grappled.`);
    return;
}
```

**Never** use `getImmunityBonuses(actor, 'grapple')` for effect-style immunity -- that only works for the `"grapple"` subtype which does NOT exist in the built-in system. Use `checkEffectImmunities` + `subtype: "effect"` instead.

---

## Target Modifier Bonuses

A bonus type that injects target-level properties onto attack and damage HUD targets. Applied to the **attacker** actor, modifies how the attacker's rolls interact with targets.

### Attack Card Subtypes
| Subtype | Effect |
|---|---|
| `"invisible"` | Force `plugins.invisibility.data = 1` on targets — Lancer system handles 50% miss roll + "Invisible (*)" display |
| `"no_cover"` | Force `target.cover = 0` |
| `"soft_cover"` | Force `target.cover = 1` (at minimum) |
| `"hard_cover"` | Force `target.cover = 2` |

### Damage Card Subtypes
| Subtype | Effect |
|---|---|
| `"ap"` | Armor Piercing — damage ignores armor |
| `"half_damage"` | Half Damage — all damage halved |
| `"paracausal"` | Cannot be Reduced — damage cannot be reduced by any means |
| `"crit"` | Force critical hit (quality = 2) |
| `"hit"` | Force hit (quality >= 1) |
| `"miss"` | Force miss (quality = 0) |

### Usage
```js
// Global: apply invisible to ALL targets when this actor attacks
await api.addGlobalBonus(actor, {
    id: 'sandblast-invis',
    name: 'Sandblast',
    type: 'target_modifier',
    subtype: 'invisible'
});

// Per-target: apply half damage only to a specific token
await api.addGlobalBonus(actor, {
    id: 'half-dmg-specific',
    name: 'Weakened Strike',
    type: 'target_modifier',
    subtype: 'half_damage',
    applyTo: [targetTokenId]
});
```

### Display Behavior
- **Attack card**: shows as toggleable checkbox in the Prone/Stunned section (single target) or before Manual Adjust (multi-target). Per-target mods with `applyTo` show inside matching target cards when multiple targets.
- **Damage card**: shows in "Global Bonuses" section. Per-target mods show inside matching target cards. Per-target checkboxes (1/2, AP, paracausal) are programmatically clicked to trigger Svelte reactivity.
- **TAH status panel**: shows as "Target: Invisible (50% miss)" etc. in the bonuses list.

---

## `onInit` Callback — NOT a Trigger

`onInit` is a **separate callback field** on the reaction config, not a trigger type. The `triggers` array must be **empty** for `onInit`-only reactions. The `autoActivate`, `triggerSelf`, `triggerOther` flags should all be `false`.

```js
reactions: [{
    triggers: [],            // <-- EMPTY -- onInit is not a trigger
    triggerSelf: false,
    triggerOther: false,
    autoActivate: false,
    activationType: "none",
    onInit: async function (token, item, api) {
        // runs once when token enters scene
        await api.addConstantBonus(token.actor, { ... });
    }
}]
```

**Never** put `"onInit"` in the `triggers` array -- it is not a `TriggerType`.

---

## `sendMessageToReactor` — Type Cast Required for 3-Arg Form

`triggerData.sendMessageToReactor` is typed as `(data, userId?) => Promise<void>`. The options third argument is not in the type. Cast required:

```js
// With wait + wait card:
const result = /** @type {any} */(await (/** @type {any} */(triggerData.sendMessageToReactor))(
    data,
    targetUserId,
    {
        wait: true,
        waitTitle: "CARD TITLE",
        waitDescription: "Shown on sender's side while waiting...",
        waitItem: item,
        waitOriginToken: reactorToken,
        waitRelatedToken: targetToken
    }
));
```

**`wait: true`** makes the call block until the remote `onMessage` resolves and passes back its return value.
**`waitTitle` / `waitDescription` / `waitItem` / `waitOriginToken` / `waitRelatedToken`** — show a non-interactive choice-card-style waiting card on the sender's screen. Card auto-dismisses when the response arrives.

### `onMessage` return value pattern
```js
onMessage: async function (triggerType, data, reactorToken, item, activationName, api) {
    return /** @type {Promise<any>} */(new Promise(async resolve => {
        await api.startChoiceCard({
            title: "MY CARD",
            choices: [{ text: "Roll", icon: "fas fa-dice", callback: async () => {
                // ... do something ...
                resolve({ myResult: true });
            }}]
        });
    }));
}
```
The object passed to `resolve(...)` is what the `wait: true` caller receives as its return value.

---

## `onDestroyed` Trigger — Fires on Token Delete, Not HP Drop

`onDestroyed` is fired from a `deleteToken` hook in `main.js`, **only when `structure.value <= 0 || stress.value <= 0`** at deletion time. It does NOT fire on every HP-drop-to-zero (that was the old behavior, removed). This means:
- It correctly fires when a unit is truly dead (at least one struct/stress already gone)
- It does NOT fire on normal structure damage where the unit survives

Use a `feign_death` flag to guard against re-triggering on a feigned token's second death.

---

## Weapon Size — Use `item.system.size`, NOT Tags

Lancer weapon sizes are stored in `item.system.size`, not as tag IDs. Possible values: `"Main"`, `"Auxiliary"`, `"Heavy"`, `"Superheavy"`.

```js
// CORRECT:
const isHeavyPlus = item.system.size === "Heavy" || item.system.size === "Superheavy";

// WRONG -- there is no tag for weapon size:
const isHeavy = item.system.tags?.some(t => t.id === "tg_heavy"); // <-- does not exist
```

---

## Damage Application — Trigger Structure Flow

To deal damage that may trigger structure/stress rolls (the same as what the Lancer UI does when HP hits 0), **update HP directly via `actor.update`**. Lancer's `_onUpdate` hook automatically calls `beginStructureFlow()` when `system.hp.value <= 0`.

```js
// Apply HP-max kinetic damage -- will trigger structure flow if HP hits 0:
const hpMax = target.actor.system.hp.max;
const current = target.actor.system.hp.value;
await target.actor.update({ "system.hp.value": current - hpMax });
```

Do NOT try to inject damage into `flowState.data.damage` after the attack -- that only works before the damage card is rendered.

---

## `startWaitCard` — Non-Interactive Waiting Card

A utility in `scripts/interactive/network.js` (exported via `index.js`). Creates a disabled, non-interactive choice-card-style card shown to the local user while waiting for a remote response. Returns `{ remove() }`.

```js
const card = api.startWaitCard({
    title: "WAITING",
    description: "Waiting for the player to decide...",
    waitMessage: "Waiting for Player Name...",  // hourglass line
    item: myItem,             // optional -- shows item chip
    originToken: reactorToken,
    relatedToken: targetToken
});

// later, when done:
card.remove();
```

Used internally by `_buildSendMessageToReactor` when `wait: true` and `waitTitle`/`waitDescription` are provided.

---

## Registration Pattern — All Item Reactions Go in One Call

All item reactions in `startups/itemActivations.js` are registered in a **single `api.registerDefaultItemReactions({...})` call** at the top of the file (around line 1080). Additional reactions requiring new calls are appended **after** the main closing `});`.

General reactions use `api.registerDefaultGeneralReactions({...})` -- also batched.

**Pattern for a new NPC feature:**
```js
api.registerDefaultItemReactions({
    "lid_of_the_item": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                // ...
            }
        }]
    }
});
```

**Pattern for `onInit`:**
```js
api.registerDefaultItemReactions({
    "lid_of_the_item": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api) {
                await api.addConstantBonus(token.actor, {
                    id: `my-bonus-${item.id}`,
                    name: "My Feature",
                    type: "immunity",
                    subtype: "effect",
                    effects: ["slowed"]
                });
            }
        }]
    }
});
```

---

## Source Tracking on Effects — `extraFlags` Pattern

When applying an effect that must be later removed by its specific source (e.g. a Sniper's mark that should only be cleared by *that* Sniper):

```js
// Apply with source tag:
await api.applyEffectsToTokens({
    tokens: [target],
    effectNames: [{ name: "My Mark", isCustom: true, icon: "icons/svg/target.svg" }],
    duration: { label: 'unlimited' }
}, { mySourceId: reactorToken.id });   // <-- stored in flags['lancer-automations']

// Remove only this source's mark:
await api.removeEffectsByNameFromTokens({
    tokens: [target],
    effectNames: ["My Mark"],
    extraFlags: { mySourceId: reactorToken.id }   // <-- must match
});

// Find if this source's mark exists on a token:
const effect = api.findEffectOnToken(target,
    e => e.name === "My Mark" && e.flags?.['lancer-automations']?.mySourceId === reactorToken.id
);
```

---

## TemplateMacro Integration

The `templatemacro` module is used for zone-based effects:
- `tmApi.findContained(templateDoc)` — Returns array of token document IDs inside a MeasuredTemplate. Used by Citadel Terraformer (Tremor, Rift collapse, Sharpen prone check).
- `placeZone` creates MeasuredTemplates with optional `difficultTerrain`, `statusEffects`, `dangerous` data.
- Dangerous terrain immunity: main.js wraps templatemacro's zone damage flow to check for terrain immunity bonuses before applying.
- Templates persist as MeasuredTemplate documents and can be stored in actor flags for later cleanup (e.g. smoke templates deleted on turn start).

---

## Dialog Styling Conventions

All custom dialogs in this module use a **two-layer header** pattern: the native Foundry title bar is hidden and replaced by a styled red banner inside the dialog content.

### Required pattern for any new Dialog
```js
new Dialog({ title: "...", content: ..., buttons: ... }, {
    width: ...,
    classes: ['lancer-dialog-base', 'lancer-no-title']   // REQUIRED -- hides native Foundry title bar
})
```

### Inside content HTML
```html
<div class="lancer-dialog-header">
    <div class="lancer-dialog-title">TITLE IN CAPS</div>
    <div class="lancer-dialog-subtitle">Optional subtitle text.</div>
</div>
```

- `lancer-no-title` -- hides the native `.window-header` bar (provided by `lancer-style-library`)
- `lancer-dialog-header` -- red background banner (provided by `lancer-style-library`)
- Without `lancer-no-title`, two headers stack: the native gray bar on top + the red banner below

---

## Type Definitions Overview

`scripts/typing/types.d.ts` (783 lines) contains the canonical type definitions:

**Key interfaces:**
- `TriggerDataBase` — Common fields: `triggeringToken`, `distanceToTrigger`, `startRelatedFlow`, `startRelatedFlowToReactor`, `sendMessageToReactor`, `flowState`, `actionData`
- Per-trigger interfaces: `TriggerDataOnMove`, `TriggerDataOnPreMove`, `TriggerDataOnDamage`, `TriggerDataOnAttack`, etc.
- `MoveHistoryEntry` / `MoveHistoryData` / `MovementHistoryResult` / `MoveSummary` — Movement tracking types
- `FlowState` — Lancer flow injection interface
- `ConsumptionConfig` — Effect consumption configuration
- `ReactionConfig` — Full reaction shape (triggers, evaluate, activationCode, onInit, onMessage, etc.)
- `ReactionGroup` — `{ category, itemType, reactions: ReactionConfig[] }`
- `LancerAutomationsAPI` — Complete API type

`external-globals.d.ts` augments: Sequencer, FlagConfig (Actor/Token/Item/ActiveEffect/Combat), CodeMirror, libWrapper, Combatant, Combat, ActiveEffect, Token (elevationruler, _movement).

`lancer-system.d.ts` defines: LancerActorSystem (HP/heat/stress/structure, action tracker, armor, resistances), LancerLoadout, LancerWeaponMount, LancerAction, LancerItemSystem.

---

## Scalability Philosophy

This module follows these design principles:
- **Batch registration**: all NPC features in itemActivations.js use batched `registerDefaultItemReactions` calls. Same reaction objects can be shared across multiple LIDs.
- **Factory functions**: `buildDefenseNetReaction(radius, isRebake)`, `createGenericBonusStep(rollType)` — reuse logic with parameterization.
- **LID-based keying**: reactions registered by item LID, not item name. Supports multiple LID variants (rebake, homebrew prefixes) mapping to same reaction object.
- **API composition**: each subsystem exports its own API object, composed via spread in main.js ready hook.
- **Startup script isolation**: itemActivations.js runs as a startup script, not imported directly — enables hot-reload and user toggle.
- **General over specific**: when adding UI or features, prefer solutions that work for all action types/items rather than specific ones. Example: the choice card system handles all interactive decisions rather than each feature building its own dialog.

---

## AI Workflow Rules

### Ask before acting
- If a task requires looking up information (file contents, data shapes, API behavior) that isn't already in context, ask the user first rather than searching blindly.
- If the user's intent is ambiguous, ask for clarification before writing any code.
- Never be overconfident about the system -- always ask for peer review and approval before acting.

### Never fix automatically
- ESLint formatting errors: `indent`, `semi`, `max-len`, `brace-style`, `no-trailing-spaces`, `eol-last`, `object-property-newline` -- user handles these
- `no-unused-vars` warnings -- informational only
- Deprecation warnings on functions that still work in Foundry v12

### Do fix
- TypeScript `ts(XXXX)` errors (2304, 2339, 2345, 2322, etc.)
- `eslint no-undef` on a Foundry class -- add it to `eslint.config.js` globals, do not change code
- Runtime bugs: wrong property path, genuinely undefined variable

### Type fix priority (in order)
1. Interface augmentation in `scripts/typing/external-globals.d.ts`
2. JSDoc `@param` with specific type on the function
3. Narrow cast: `/** @type {SpecificType} */ (expr)`
4. Last resort: `/** @type {any} */` only on the minimal expression, never the whole object

### False positive signals
- `eslint no-undef` on a Foundry global -- missing from `eslint.config.js`, not a real error
- `ts(2339)` property missing -- check `external-globals.d.ts` before casting; augment if the property genuinely exists at runtime
- `foundry-vtt-types` library bugs (e.g. `command: null` on Macro) -- cast the single field, document why

---

## Important: What NOT to Break
- `/*global ...*/` comments at top of files (ESLint globals)
- `stringToFunction` / `stringToAsyncFunction` -- user-authored code strings are compiled here; do not change arg names without updating all call sites
- Socket event shape -- changing payload structure breaks multiplayer
- The `api` object spread order in `main.js` ready hook -- later spreads override earlier ones
- The `_savedFlowSteps` / `_savedFlowStepArrays` / `_addedFlowKeys` rollback mechanism in `alt-struct/index.js`
- The `ActiveFlowState.current` synchronous timing in `flows.js`

---

## Lancer System — Data Structure Reference

Source: `lancer-a96e7e01.mjs` (38,336 lines) in the Lancer system.

### Actor Types (4)

#### MECH
```
system.hp               — {min, max, value}
system.heat             — {min, max, value}
system.stress           — {min, max, value}
system.structure        — {min, max, value}
system.overshield       — {min, max, value}
system.burn             — Number (integer, min:0)
system.activations      — Number (integer, min:0, initial:1)
system.overcharge       — Number (0-indexed: 0=+1, 1=+1d3, 2=+1d6, 3=+1d6+4)
system.repairs          — {min, max, value}
system.core_active      — Boolean
system.core_energy      — Number (min:0, initial:1)
system.meltdown_timer   — Number (nullable)
system.pilot            — SyncUUIDRefField -> PILOT actor
system.lid              — LIDField
system.notes            — HTML

system.action_tracker.protocol  — Boolean
system.action_tracker.move      — Number (remaining, = speed)
system.action_tracker.full      — Boolean
system.action_tracker.quick     — Boolean
system.action_tracker.reaction  — Boolean
system.action_tracker.free      — Boolean
system.action_tracker.used_reactions — String[] (LIDs)

system.loadout.frame              — EmbeddedRefField -> FRAME item
system.loadout.weapon_mounts[]    — Array of mounts
  .type                           — MountType enum
  .bracing                        — Boolean
  .slots[]                        — Array of slots
    .weapon                       — EmbeddedRefField -> MECH_WEAPON
    .mod                          — EmbeddedRefField -> WEAPON_MOD
    .size                         — FittingSize enum
system.loadout.systems[]          — EmbeddedRefField[] -> MECH_SYSTEM items
system.loadout.sp                 — {min, max, value} (system points)
system.loadout.ai_cap             — {min, max, value}
system.loadout.limited_bonus      — Number
```

#### PILOT
```
system.hp, system.overshield, system.burn, system.activations — same as mech
system.action_tracker.*           — same as mech

system.active_mech    — SyncUUIDRefField -> MECH actor
system.level          — Number (0-12)
system.hull           — Number (0-6) — HASE stats
system.agi            — Number (0-6)
system.sys            — Number (0-6)
system.eng            — Number (0-6)
system.mounted        — Boolean (in mech or on foot)
system.callsign       — String
system.player_name    — String

system.loadout.armor[]    — EmbeddedRefField[] -> PILOT_ARMOR
system.loadout.gear[]     — EmbeddedRefField[] -> PILOT_GEAR
system.loadout.weapons[]  — EmbeddedRefField[] -> PILOT_WEAPON

system.bond_state.xp            — {min, max, value} (0-8)
system.bond_state.stress        — {min, max, value} (0-8)
system.bond_state.xp_checklist  — {major_ideals: [bool,bool,bool], minor_ideal, veteran_power}
system.bond_state.answers       — String[]
system.bond_state.burdens       — CounterField[]
system.bond_state.clocks        — CounterField[]
```

#### NPC
```
system.hp, system.heat, system.stress, system.structure, system.overshield, system.burn, system.activations — same as mech
system.action_tracker.* — same as mech

system.tier             — Number (1-3)
system.destroyed        — Boolean
system.disabled         — Boolean
system.meltdown_timer   — Number (nullable)
```
NPC stats (armor, evasion, edef, save, speed, sensor_range, size, heatcap) are **computed** from the NPC_CLASS item's `base_stats[tier-1]` at prepareData time. Access via `actor.system.armor`, `actor.system.evasion`, etc.

#### DEPLOYABLE
```
system.hp, system.heat, system.overshield, system.burn, system.activations — same as mech

system.type             — DeployableType (Deployable, Drone, Mine, Turret, SprayWeapon, Orbital)
system.owner            — SyncUUIDRefField -> owning actor (MECH/PILOT/NPC)
system.deployer         — SyncUUIDRefField -> deploying actor
system.activation       — ActivationType
system.deactivation     — ActivationType (nullable)
system.recall           — ActivationType (nullable)
system.redeploy         — ActivationType (nullable)
system.cost             — Number (SP)
system.instances        — Number (min:1)
system.detail           — HTML
system.avail_mounted    — Boolean
system.avail_unmounted  — Boolean

system.stats.armor, .edef, .evasion, .heatcap, .hp (formula string), .save, .size, .speed
system.actions[], system.counters[], system.synergies[], system.tags[]
```

### Item Types (18)

#### MECH_WEAPON
```
system.lid              — LIDField
system.size             — WeaponSize (Auxiliary, Main, Heavy, Superheavy)
system.loaded           — Boolean
system.selected_profile_index — Number
system.sp               — Number (SP cost)
system.cascading, system.destroyed, system.disabled — Booleans
system.uses             — {min, max, value}

system.profiles[]       — Array (min length 1):
  .name                 — String (default "Base Profile")
  .type                 — WeaponType (Rifle, Cannon, Launcher, CQB, Nexus, Melee)
  .damage[]             — DamageField[] ({type: DamageType, val: string})
  .range[]              — RangeField[] ({type: RangeType, val: string|number})
  .tags[]               — TagField[] ({lid, val})
  .description, .effect, .on_attack, .on_hit, .on_crit — Strings
  .cost                 — Number
  .skirmishable, .barrageable — Booleans
  .actions[], .bonuses[], .synergies[], .counters[]

system.bonuses[], system.actions[], system.synergies[], system.counters[]
system.deployables[]    — LIDField[] (deployable LIDs)
system.integrated[]     — LIDField[]
system.tags[]           — TagField[] (weapon-level tags)
```

#### MECH_SYSTEM
```
system.lid, system.cascading, system.destroyed, system.disabled
system.uses             — {min, max, value}
system.sp               — Number
system.effect           — HTML
system.description      — HTML
system.type             — String (System, AI, Shield, Deployable, Drone, Tech, Armor, Flight System, Integrated, Mod)
system.loaded           — Boolean
system.manufacturer     — String (default "GMS")
system.license_level    — Number (0-3)
system.license          — String
system.ammo[]           — AmmoField[] ({name, description, cost, allowed_types, allowed_sizes, ...})
system.bonuses[], system.actions[], system.synergies[], system.counters[], system.deployables[], system.integrated[], system.tags[]
```

#### WEAPON_MOD
```
system.lid, system.cascading, system.destroyed, system.disabled, system.uses
system.sp, system.effect, system.description, system.manufacturer, system.license_level, system.license
system.added_tags[]     — TagField[]
system.added_damage[]   — DamageField[]
system.added_range[]    — RangeField[]
system.allowed_types    — WeaponTypeChecklistField
system.allowed_sizes    — WeaponSizeChecklistField
system.bonuses[], system.actions[], system.synergies[], system.counters[], system.deployables[], system.integrated[], system.tags[]
```

#### FRAME
```
system.lid, system.manufacturer, system.license_level, system.license
system.description      — HTML
system.mechtype[]       — String[] (Balanced, Artillery, Striker, Controller, Support, Defender, Specialty)
system.mounts[]         — String[] of MountType

system.stats.armor, .edef, .evasion, .heatcap, .hp, .repcap, .save, .sensor_range, .size, .sp, .speed, .stress, .structure, .tech_attack

system.traits[]         — Array:
  .name, .description (HTML)
  .bonuses[], .counters[], .integrated[], .deployables[], .actions[], .synergies[]
  .use                  — FrameEffectUse (nullable)

system.core_system      — Object:
  .name, .description, .activation, .deactivation, .use
  .active_name, .active_effect, .active_synergies[], .active_bonuses[], .active_actions[]
  .passive_name, .passive_effect, .passive_synergies[], .passive_bonuses[], .passive_actions[]
  .deployables[], .counters[], .integrated[], .tags[]
```

#### NPC_CLASS
```
system.lid, system.role, system.flavor (HTML), system.tactics (HTML)
system.base_features    — Set<LID> (feature LIDs that spawn with NPC)
system.optional_features — Set<LID>
system.base_stats[]     — Array of 3 NpcStatBlocks (one per tier):
  {hp, armor, edef, evasion, save, speed, sensor_range, size, activations, heatcap}
```

#### NPC_FEATURE
```
system.lid
system.type             — NpcFeatureType (Trait, System, Reaction, Weapon, Tech)
system.effect           — HTML
system.charged          — Boolean (recharge status)
system.loaded           — Boolean
system.tier_override    — Number (0-3, 0=use actor tier)
system.cascading, system.destroyed, system.disabled
system.uses             — {min, max, value}
system.tags[]           — TagField[]
system.origin           — {type, name, base}

Weapon type:  system.weapon_type, system.damage[][] (2D: tiers x damages), system.range[],
              system.on_hit (HTML), system.accuracy[3], system.attack_bonus[3]
Tech type:    system.tech_type (Quick|Full), system.tech_attack (Boolean|null)
Reaction:     system.trigger (String)
```

#### TALENT
```
system.lid, system.curr_rank (1-3), system.description (HTML), system.terse
system.ranks[]          — Array (3 tiers):
  .name, .description, .exclusive
  .actions[], .bonuses[], .synergies[], .deployables[], .counters[], .integrated[]
```

#### Other Items
- **PILOT_WEAPON**: system.range[], system.damage[], system.effect, system.loaded, system.uses
- **PILOT_ARMOR / PILOT_GEAR**: system.description, system.effect, system.uses
- **CORE_BONUS**: system.description, system.effect, system.mounted_effect, system.manufacturer
- **SKILL**: system.description, system.detail, system.curr_rank (1-3)
- **LICENSE**: system.key, system.manufacturer, system.curr_rank (1-3)
- **RESERVE**: system.consumable, system.label, system.type (Resources|Tactical|Mech|Project|Organization|Bonus), system.used, system.description
- **STATUS**: system.effects (HTML), system.type ("status"|"condition"|"effect"), system.terse
- **BOND**: system.major_ideals[], system.minor_ideals[], system.questions[], system.powers[]
- **NPC_TEMPLATE**: system.description, system.base_features (Set<LID>), system.optional_features (Set<LID>)

### Tags System

Tag shape: `{ lid: string, val: string }`

| Tag ID | Getter | Purpose |
|---|---|---|
| `tg_unique` | `is_unique` | One per mech |
| `tg_ai` | `is_ai` | AI system |
| `tg_ap` | `is_ap` | Armor Piercing |
| `tg_limited` | `is_limited` | Max uses = val |
| `tg_loading` | `is_loading` | Must reload after use |
| `tg_recharge` | `is_recharge` | Recharges on roll >= val |
| `tg_indestructible` | `is_indestructible` | Cannot be destroyed |
| `tg_smart` | `is_smart` | Targets E-DEF |
| `tg_seeking` | `is_seeking` | Ignores cover |
| `tg_overkill` | `is_overkill` | +1d6 on crit, +1 heat |
| `tg_accurate` | `is_accurate` | +1 accuracy |
| `tg_inaccurate` | `is_inaccurate` | +1 difficulty |
| `tg_reliable` | `is_reliable` | Min damage = val |
| `tg_heat_self` | `is_selfheat` | Generates val heat on use |
| `tg_knockback` | `is_knockback` | Push val spaces |
| `tg_overshield` | `is_overshield` | Grant val overshield |
| `tg_no_cascade` | `is_cascaderesistant` | Resists cascade |
| `tg_ordnance` | `is_ordnance` | Ordnance weapon |

Tag.MergeTags() sums: reliable, heat_self, knockback, overshield. Keeps both: accurate, inaccurate. Min: limited. Max: recharge.

NPC tier-scaled values: `tag.val = "{5/7/9}"` -> `tag.tierVal(1)` returns `"5"`.

### LID System

LID (Lancer ID) prefixes by type:
```
core_bonus -> "cb_"      frame -> "mf_"          mech_weapon -> "mw_"
mech_system -> "ms_"     weapon_mod -> "wm_"     npc_class -> "npcc_"
npc_template -> "npct_"  npc_feature -> "npcf_"  talent -> "t_"
deployable -> "dep_"     license -> "lic_"        skill -> "sk_"
pilot_armor/gear/weapon -> "pg_"     reserve -> "reserve_"
```

### Lancer Flow System (23 flows)

#### Attack Flows
- **BasicAttackFlow**: initAttackData -> setAttackTags -> setAttackEffects -> setAttackTargets -> showAttackHUD -> rollAttacks -> applySelfHeat -> printAttackCard
- **WeaponAttackFlow** (extends Basic): + checkItemDestroyed -> checkWeaponLoaded -> checkItemLimited -> checkItemCharged -> updateItemAfterAction
- **TechAttackFlow**: initTechAttackData -> ... -> printTechAttackCard (always targets E-DEF)

#### Damage
- **DamageRollFlow**: initDamageData -> setDamageTags -> setDamageTargets -> showDamageHUD -> rollReliable -> rollNormalDamage -> rollCritDamage -> applyOverkillHeat -> printDamageCard

#### Activation
- **ActivationFlow**: initActivationData -> checks -> applySelfHeat -> updateItemAfterAction -> printActionUseCard
- **CoreActiveFlow** (extends Activation): + checkCorePower -> consumeCorePower
- **SystemFlow**: initSystemUseData -> checks -> printSystemCard
- **SimpleActivationFlow**: printActionUseCard only

#### Structure / Stress
- **StructureFlow**: preStructureRollChecks -> rollStructureTable -> noStructureRemaining -> checkStructureMultipleOnes -> buttons -> printStructureCard
- **OverheatFlow**: preOverheatRollChecks -> rollOverheatTable -> noStressRemaining -> checkOverheatMultipleOnes -> buttons -> printOverheatCard
- **SecondaryStructureFlow**: secondaryStructureRoll (1d6: 1-3=weapon destroyed, 4-6=system destroyed)

#### Other Flows
- **StatRollFlow**: initStatRollData -> showStatRollHUD -> rollCheck -> printStatRollCard
- **OverchargeFlow**: initOverchargeData -> rollOvercharge -> updateOverchargeActor -> printOverchargeCard
- **StabilizeFlow**: initializeStabilize -> renderStabilizePrompt -> applyStabilizeUpdates -> printStabilizeResult
- **FullRepairFlow**: displayFullRepairDialog -> executeFullRepair
- **NPCRechargeFlow**: findRechargeableSystems -> rollRecharge -> applyRecharge -> printRechargeCard
- **BurnFlow**: initBurnCheckData -> rollBurnCheck -> checkBurnResult -> printDamageCard
- **CascadeFlow**: initCascadeData -> cascadeRoll -> cascadeUpdateItems -> printCascadeCards
- **TalentFlow**, **BondPowerFlow**, **SimpleTextFlow**, **SimpleHTMLFlow**, **ActionTrackFlow**

#### Flow Hooks
- `lancer.preFlow.{FlowName}` — before flow begins
- `lancer.postFlow.{FlowName}` — after flow completes (receives flow, success)
- `lancer.registerFlows` — called with (flowSteps, flows) for third-party modules to inject steps

#### Flow State Shape
```js
state = { name, actor, item, currentStep, data: { ...flow-specific } }
```
Steps receive `(state, options)`, return truthy to continue, falsy to abort.

### Combat System

- `LancerCombat.activateCombatant(id)` — spend 1 activation
- `LancerCombat.deactivateCombatant(id)` — return turn
- `LancerCombatant.activations` — {max, value}
- Turn start: refresh reactions, reset action tracker, optionally NPCRechargeFlow
- Turn end: spend actions, trigger BurnFlow if burn > 0

#### Action Tracker
```
protocol — 1x per turn, disabled when any action spent
move     — = actor speed, spend sets to 0, refresh = speed
full     — spend = both full+quick gone, refresh = both true
quick    — spend = full (prefer) then quick, refresh = quick true
reaction — spend = false, refresh = true
free     — tracks usage only
```

#### Overcharge Levels
Default sequence: `+1, +1d3, +1d6, +1d6+4`. Tracked in `system.overcharge` (0-indexed). Configurable via `system.overcharge_sequence`.

### Key Enumerations

```
ActivationType:  None, Passive, Quick, Quick Tech, Invade, Full, Full Tech, Other, Reaction, Protocol, Free
WeaponType:      Rifle, Cannon, Launcher, CQB, Nexus, Melee
WeaponSize:      Auxiliary, Main, Heavy, Superheavy
MountType:       Main, Heavy, Aux/Aux, Aux, Main/Aux, Flex, Integrated, Superheavy, Unknown
FittingSize:     Auxiliary, Main, Flex, Heavy, Superheavy, Integrated
RangeType:       Range, Threat, Thrown, Line, Cone, Blast, Burst
DamageType:      Kinetic, Energy, Explosive, Heat, Burn, Variable
NpcFeatureType:  Trait, System, Reaction, Weapon, Tech
DeployableType:  Deployable, Drone, Mine, Turret, SprayWeapon, Orbital
MechType:        Balanced, Artillery, Striker, Controller, Support, Defender, Specialty
```

### Common Access Patterns
```js
// Actor stats
actor.system.hp.value / .max          actor.system.heat.value / .max
actor.system.structure.value / .max   actor.system.stress.value / .max
actor.system.overshield.value         actor.system.burn
actor.system.armor                    actor.system.evasion
actor.system.edef                     actor.system.save
actor.system.speed                    actor.system.sensor_range
actor.system.size                     actor.system.tech_attack
actor.system.activations              actor.system.overcharge

// Pilot HASE
actor.system.hull / .agi / .sys / .eng   // 0-6 each

// NPC tier
actor.system.tier                     // 1, 2, or 3

// Loadout
actor.system.loadout.frame.value                        // frame Item
actor.system.loadout.weapon_mounts[i].slots[j].weapon.value  // weapon Item
actor.system.loadout.weapon_mounts[i].slots[j].mod.value      // mod Item
actor.system.loadout.systems[i].value                   // system Item

// Item data
item.system.lid                       // Lancer ID
item.system.tags                      // TagField[]
item.system.loaded                    // weapon/system loaded state
item.system.profiles[0].damage        // weapon damage array
item.system.profiles[0].range         // weapon range array
item.system.size                      // weapon size (Main, Heavy, etc.)
item.system.uses.value / .max         // limited uses

// NPC feature tier access
npcFeature.system.damage[tierIndex]   // damage array for specific tier
npcFeature.system.accuracy[tierIndex] // accuracy for specific tier
npcFeature.system.attack_bonus[tierIndex]

// Item collections
actor.items.filter(i => i.type === "mech_weapon")
actor.itemTypes.mech_weapon           // shorthand
```

---

## Status List

All current statuses registered by the module and system:

[
    {
        "id": "immobilized",
        "name": "lancer.statusIconsNames.immobilized",
        "img": "systems/lancer/assets/icons/white/condition_immobilized.svg",
        "description": "IMMOBILIZED characters cannot make any voluntary movements, although involuntary movements are unaffected."
    },
    {
        "id": "impaired",
        "name": "lancer.statusIconsNames.impaired",
        "img": "systems/lancer/assets/icons/white/condition_impaired.svg",
        "description": "IMPAIRED characters receive +1 difficulty on all attacks, saves, and skill checks."
    },
    {
        "id": "jammed",
        "name": "lancer.statusIconsNames.jammed",
        "img": "systems/lancer/assets/icons/white/condition_jammed.svg",
        "description": "JAMMED characters can't:<br />use comms to talk to other characters;<br />make attacks, other than IMPROVISED ATTACK, GRAPPLE, and RAM;<br />take reactions, or take or benefit from tech actions."
    },
    {
        "id": "lockon",
        "name": "lancer.statusIconsNames.lockon",
        "img": "systems/lancer/assets/icons/white/condition_lockon.svg",
        "description": "Hostile characters can choose to consume a character's LOCK ON condition in exchange for +1 accuracy on their next attack against that character.<br />LOCK ON is also required to use some talents and systems."
    },
    {
        "id": "shredded",
        "name": "lancer.statusIconsNames.shredded",
        "img": "systems/lancer/assets/icons/white/condition_shredded.svg",
        "description": "SHREDDED characters don't benefit from ARMOR or RESISTANCE."
    },
    {
        "id": "slow",
        "name": "lancer.statusIconsNames.slow",
        "img": "systems/lancer/assets/icons/white/condition_slow.svg",
        "description": "The only movement SLOWED characters can make is their standard move, on their own turn -- they can't BOOST or make any special moves granted by talents, systems, or weapons."
    },
    {
        "id": "stunned",
        "name": "lancer.statusIconsNames.stunned",
        "img": "systems/lancer/assets/icons/white/condition_stunned.svg",
        "description": "STUNNED mechs cannot OVERCHARGE, move, or take any actions -- including free actions and reactions. Pilots can still MOUNT, DISMOUNT, or EJECT from STUNNED mechs, and can take actions normally.<br />STUNNED mechs have a maximum of 5 EVASION, and automatically fail all HULL and AGILITY checks and saves."
    },
    {
        "id": "dangerzone",
        "name": "lancer.statusIconsNames.dangerzone",
        "img": "systems/lancer/assets/icons/white/status_dangerzone.svg",
        "description": "Characters are in the DANGER ZONE when half or more of their heat is filled in."
    },
    {
        "id": "downandout",
        "name": "lancer.statusIconsNames.downandout",
        "img": "systems/lancer/assets/icons/white/status_downandout.svg",
        "description": "Pilots that are DOWN AND OUT are unconscious and STUNNED -- if they take any more damage, they die."
    },
    {
        "id": "engaged",
        "name": "lancer.statusIconsNames.engaged",
        "img": "systems/lancer/assets/icons/white/status_engaged.svg",
        "description": "If a character moves adjacent to a hostile character, they both gain the ENGAGED status. Ranged attacks made by ENGAGED characters receive +1 difficulty."
    },
    {
        "id": "exposed",
        "name": "lancer.statusIconsNames.exposed",
        "img": "systems/lancer/assets/icons/white/status_exposed.svg",
        "description": "All kinetic, explosive, or energy damage taken by EXPOSED characters is doubled, before applying any reductions."
    },
    {
        "id": "hidden",
        "name": "lancer.statusIconsNames.hidden",
        "img": "systems/lancer/assets/icons/white/status_hidden.svg",
        "description": "HIDDEN characters can't be targeted by hostile attacks or actions, don't cause engagement."
    },
    {
        "id": "invisible",
        "name": "lancer.statusIconsNames.invisible",
        "img": "systems/lancer/assets/icons/white/status_invisible.svg",
        "description": "All attacks against INVISIBLE characters have a 50 percent chance to miss outright, before an attack roll is made."
    },
    {
        "id": "intangible",
        "name": "lancer.statusIconsNames.intangible",
        "img": "systems/lancer/assets/icons/white/status_intangible.svg",
        "description": "INTANGIBLE characters can move through obstructions but not end turns in them. Can only affect other Intangible characters."
    },
    {
        "id": "prone",
        "name": "lancer.statusIconsNames.prone",
        "img": "systems/lancer/assets/icons/white/status_prone.svg",
        "description": "Attacks against PRONE targets receive +1 accuracy. PRONE characters are SLOWED and count as moving in difficult terrain."
    },
    {
        "id": "shutdown",
        "name": "lancer.statusIconsNames.shutdown",
        "img": "systems/lancer/assets/icons/white/status_shutdown.svg",
        "description": "SHUT DOWN mechs have IMMUNITY to all tech actions/attacks. While SHUT DOWN, mechs are STUNNED indefinitely."
    },
    {
        "id": "bolster",
        "name": "lancer.statusIconsNames.bolster",
        "img": "icons/svg/upgrade.svg"
    },
    { "id": "npc_tier_1", "name": "lancer.statusIconsNames.npc_tier_1", "img": "systems/lancer/assets/icons/white/npc_tier_1.svg" },
    { "id": "npc_tier_2", "name": "lancer.statusIconsNames.npc_tier_2", "img": "systems/lancer/assets/icons/white/npc_tier_2.svg" },
    { "id": "npc_tier_3", "name": "lancer.statusIconsNames.npc_tier_3", "img": "systems/lancer/assets/icons/white/npc_tier_3.svg" },
    { "id": "flying", "name": "lancer.statusIconsNames.flying", "img": "icons/svg/wing.svg" },
    { "id": "resistance_burn", "name": "lancer.statusIconsNames.resistance_burn", "img": "systems/lancer/assets/icons/white/resistance_burn.svg" },
    { "id": "resistance_energy", "name": "lancer.statusIconsNames.resistance_energy", "img": "systems/lancer/assets/icons/white/resistance_energy.svg" },
    { "id": "resistance_explosive", "name": "lancer.statusIconsNames.resistance_explosive", "img": "systems/lancer/assets/icons/white/resistance_explosive.svg" },
    { "id": "resistance_heat", "name": "lancer.statusIconsNames.resistance_heat", "img": "systems/lancer/assets/icons/white/resistance_heat.svg" },
    { "id": "resistance_kinetic", "name": "lancer.statusIconsNames.resistance_kinetic", "img": "systems/lancer/assets/icons/white/resistance_kinetic.svg" },
    { "id": "cover_hard", "name": "lancer.statusIconsNames.cover_hard", "img": "systems/lancer/assets/icons/white/cover_hard.svg" },
    { "id": "cover_soft", "name": "lancer.statusIconsNames.cover_soft", "img": "systems/lancer/assets/icons/white/cover_soft.svg" },
    { "id": "DeadRings_statuses_staggered", "name": "Staggered", "img": "systems/lancer/assets/icons/white/condition_DeadRings_statuses_staggered.svg", "description": "Staggered Characters cannot take Free Actions or Reactions." },
    { "id": "DeadRings_statuses_vulnerable", "name": "Vulnerable", "img": "systems/lancer/assets/icons/white/condition_DeadRings_statuses_vulnerable.svg", "description": "Hostile characters can consume Vulnerable on hit for 1d6 bonus damage." },
    { "id": "DeadRings_statuses_stripped", "name": "Stripped", "img": "systems/lancer/assets/icons/white/condition_DeadRings_statuses_stripped.svg", "description": "A Stripped character cannot benefit from Armor." },
    { "id": "dazed", "name": "Dazed", "img": "systems/lancer/assets/icons/white/condition_dazed.svg", "description": "DAZED mechs can only take one quick action." },
    { "id": "overheated", "name": "Overheated", "img": "systems/lancer/assets/icons/white/status_overheated.svg", "description": "Cannot take actions that inflict heat on self." },
    { "id": "core_power_active", "name": "Core Power Active", "img": "systems/lancer/assets/icons/white/corepower.svg" },
    { "id": "burn", "name": "Burn", "img": "icons/svg/fire.svg" },
    { "id": "overshield", "name": "Overshield", "img": "icons/svg/circle.svg" },
    { "id": "cascading", "name": "Cascading", "img": "icons/svg/paralysis.svg" },
    { "id": "mia", "name": "M.I.A.", "img": "modules/csm-lancer-qol/icons/mia_lg.svg" },
    {
        "id": "resistance_all",
        "name": "Resist All",
        "img": "modules/lancer-automations/icons/resist_all.svg",
        "changes": [
            { "key": "system.resistances.burn", "mode": 5, "value": "true" },
            { "key": "system.resistances.energy", "mode": 5, "value": "true" },
            { "key": "system.resistances.explosive", "mode": 5, "value": "true" },
            { "key": "system.resistances.heat", "mode": 5, "value": "true" },
            { "key": "system.resistances.kinetic", "mode": 5, "value": "true" }
        ]
    },
    { "id": "immovable", "name": "Immovable", "img": "modules/lancer-automations/icons/immovable.svg", "description": "Cannot be moved" },
    { "id": "disengage", "name": "Disengage", "img": "modules/lancer-automations/icons/disengage.svg", "description": "You ignore engagement and your movement does not provoke reactions" },
    { "id": "destroyed", "name": "Destroyed", "img": "modules/lancer-automations/icons/destroyed.svg", "description": "You are destroyed" },
    {
        "id": "grappling",
        "name": "Grappling",
        "img": "modules/lancer-automations/icons/grappling.svg",
        "description": "You are grappling in a grapple contest",
        "changes": [
            { "key": "system.statuses.engaged", "mode": 5, "value": "true" },
            { "key": "system.action_tracker.reaction", "mode": 5, "value": "false" }
        ]
    },
    {
        "id": "grappled",
        "name": "Grappled",
        "img": "modules/lancer-automations/icons/grappled.svg",
        "description": "You are grappled in a grapple contest",
        "changes": [
            { "key": "system.statuses.engaged", "mode": 5, "value": "true" },
            { "key": "system.action_tracker.reaction", "mode": 5, "value": "false" }
        ]
    },
    { "id": "falling", "name": "Falling", "img": "modules/lancer-automations/icons/falling.svg", "description": "3 Kinetic AP per 3 spaces fallen, max 9 Kinetic AP." },
    { "id": "lagging", "name": "Lagging", "img": "modules/lancer-automations/icons/lagging.svg", "description": "You can only take a quick action" },
    { "id": "infection", "name": "Infection", "img": "modules/lancer-automations/icons/infection.svg", "description": "Works like burn but targets heat instead" },
    { "id": "throttled", "name": "Throttled", "img": "modules/lancer-automations/icons/throttled.svg", "description": "Deals half damage, heat, and burn on attacks" },
    { "id": "blinded", "name": "Blinded", "img": "modules/lancer-automations/icons/blinded.svg", "description": "Line of sight reduced to 1" },
    { "id": "climber", "name": "Climber", "img": "modules/lancer-automations/icons/mountain-climbing.svg", "description": "You ignore effect of climbing terrain" },
    { "id": "terrain_immunity", "name": "Terrain Immunity", "img": "modules/lancer-automations/icons/metal-boot.svg", "description": "You ignore difficult and dangerous terrain" },
    { "id": "reactor_meltdown", "name": "Reactor Meltdown", "img": "modules/lancer-automations/icons/mushroom-cloud.svg", "description": "You are in a reactor meltdown" },
    { "id": "aided", "name": "Aided", "img": "modules/lancer-automations/icons/health-capsule.svg", "description": "You can Stabilize as a quick action" },
    {
        "id": "brace",
        "name": "Brace",
        "img": "modules/lancer-automations/icons/brace.svg",
        "changes": [
            { "key": "system.resistances.burn", "mode": 5, "value": "true" },
            { "key": "system.resistances.energy", "mode": 5, "value": "true" },
            { "key": "system.resistances.explosive", "mode": 5, "value": "true" },
            { "key": "system.resistances.heat", "mode": 5, "value": "true" },
            { "key": "system.resistances.kinetic", "mode": 5, "value": "true" }
        ]
    }
]
