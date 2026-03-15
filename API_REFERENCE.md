# Lancer Automations — API Reference

## Table of Contents

- [Accessing the API](#accessing-the-api)
- [Fundamentals](#fundamentals)
  - [Trigger Types & Data](#trigger-types--data)
    - [Attack Triggers](#attack-triggers)
    - [Tech Triggers](#tech-triggers)
    - [Movement Triggers](#movement-triggers)
    - [Turn Events](#turn-events)
    - [Status Effect Triggers](#status-effect-triggers)
    - [Damage & Structure Triggers](#damage--structure-triggers)
    - [Stat & Activation Triggers](#stat--activation-triggers)
  - [Evaluate & Activate Signatures](#evaluate--activate-signatures)
  - [Activation Object Structure](#activation-object-structure)
  - [Consumption Object Structure](#consumption-object-structure)
- [Combat & Execution Flows](#combat--execution-flows)
  - [`executeStatRoll`](#executestatrollactor-stat-title-target-extradata)
  - [`executeDamageRoll`](#executedamagerollattacker-targets-damagevalue-damagetype-title-options-extradata)
  - [`executeBasicAttack`](#executebasicattackactor-options-extradata)
  - [`executeTechAttack`](#executetechattackactor-options-extradata)
  - [`executeSimpleActivation`](#executesimpleactivationactor-options-extradata)
- [Status Effect Management](#status-effect-management)
  - [`applyEffectsToTokens`](#applyeffectstotokensoptions-extraoptions)
  - [`removeEffectsByNameFromTokens`](#removeeffectsfromtokensoptions)
  - [`removeEffectsByName`](#removeeffectsbynameactor-effectnames-originid)
  - [`deleteEffect`](#deleteeffecttoken-effect)
  - [`findEffectOnToken`](#findeffectontokentoken-identifier)
  - [`consumeEffectCharge`](#consumeeffectchargeeffect)
  - [`triggerEffectImmunity`](#triggereffectimmunitytoken-effectnames-source-notify)
  - [`deleteAllEffects`](#deletealleffects)
  - [`executeEffectManager`](#executeeffectmanageroptions)
- [Global & Constant Bonuses](#global--constant-bonuses)
  - [`addGlobalBonus`](#addglobalbonusactor-bonusdata-options)
  - [`removeGlobalBonus`](#removeglobalbonusactor-bonusid-skipeffectremoval)
  - [`getGlobalBonuses`](#getglobalbonusesactor)
  - [`addConstantBonus`](#addconstantbonusactor-bonusdata)
  - [`getConstantBonuses`](#getconstantbonusesactor)
  - [`removeConstantBonus`](#removeconstantbonusactor-bonusid)
  - [Flow State Data Injection](#flow-state-data-injection)
- [Spatial & Distance Tools](#spatial--distance-tools)
  - [Distance Calculations](#distance-calculations)
  - [Faction & Disposition](#faction--disposition)
  - [Grid & Cell Data](#grid--cell-data)
  - [Debug Visualizations](#debug-visualizations)
- [Weapon & Item Details](#weapon--item-details)
  - [`getItemTags_WithBonus`](#getitemtags_withbonusitem-actor)
  - [`getActorMaxThreat`](#getactormaxthreatactor)
  - [`getMaxWeaponRanges_WithBonus`](#getmaxweaponranges_withbonusinput)
  - [`getMaxWeaponReach_WithBonus`](#getmaxweaponreach_withbonusinput)
  - [`getWeaponType`](#getweapontypeitem)
  - [`getItemType`](#getitemtypeitem)
- [Interactive Player Tools](#interactive-player-tools)
  - [`chooseToken`](#choosetokencastertoken-options)
  - [`placeZone`](#placezonecastertoken-options)
  - [`placeToken`](#placetokenoptions)
  - [`knockBackToken`](#knockbacktokentokens-distance-options)
  - [`revertMovement`](#revertmovementtoken-destination)
  - [`startChoiceCard`](#startchoicecardoptions)
  - [`openChoiceMenu`](#openchoicemenu)
- [Deployment & Thrown Weapons](#deployment--thrown-weapons)
  - [`addItemFlags`](#additemflagsitem-flags)
  - [`getItemFlags`](#getitemflagsitem-flagname)
  - [`placeDeployable`](#placedeployableoptions)
  - [`beginDeploymentCard`](#begindeploymentcardoptions)
  - [`openDeployableMenu`](#opendeployablemenuactor)
  - [`recallDeployable`](#recalldeployableownertoken)
  - [`deployWeaponToken`](#deployweapontokenweapon-owneractor-origintoken-options)
  - [`pickupWeaponToken`](#pickupweapontokenownertoken)
  - [`openThrowMenu`](#openthrowmenuactor)
  - [`beginThrowWeaponFlow`](#beginthrowweaponflowweapon)
- [Movement Tracking](#movement-tracking)
- [Registration & Logic](#registration--logic)
  - [User Helpers](#user-helpers)
  - [Registration Functions](#registration-functions)
  - [How-To: Register Activations](#how-to-register-activations)
  - [How-To: Advanced Consumption](#how-to-advanced-consumption)

---

## Accessing the API

```javascript
const api = game.modules.get('lancer-automations').api;
```

Also available via hook for safe timing:
```javascript
Hooks.on('lancer-automations.ready', (api) => {
    // api is ready
});
```

---

## Fundamentals

### Trigger Types & Data

Every trigger passes a data object. All objects receive `distanceToTrigger` (reactor to triggering token).

#### Attack Triggers
- **`onInitAttack`**: Fires when an attack is initiated (before Attack HUD).
    - Data: `{ triggeringToken, weapon, targets, actionName, tags, actionData, cancelAttack(reasonText, title, showCard, userIdControl) }`
- **`onAttack`**: Fires when an attack roll is made.
    - Data: `{ triggeringToken, weapon, targets, attackType, actionName, tags, actionData }`
- **`onHit`**: Fires when an attack hits.
    - Data: `{ triggeringToken, weapon, targets: Array<{target, roll, crit}>, attackType, actionName, tags, actionData }`
- **`onMiss`**: Fires when an attack misses.
    - Data: `{ triggeringToken, weapon, targets: Array<{target, roll}>, attackType, actionName, tags, actionData }`
- **`onDamage`**: Fires when damage is applied.
    ```javascript
    {
        triggeringToken: Token,
        weapon: Item,
        target: Token,
        damages: Array<number>,
        types: Array<string>,
        isCrit: boolean,
        isHit: boolean,
        attackType: string,
        actionName: string,
        tags: Array,
        actionData: Object
    }
    ```

#### Tech Triggers
- **`onInitTechAttack`**: Before Tech HUD. `{ triggeringToken, techItem, targets, actionName, isInvade, tags, actionData, cancelTechAttack(reasonText, title, showCard, userIdControl) }`
- **`onTechAttack`**: Tech roll made. `{ triggeringToken, techItem, targets, actionName, isInvade, tags, actionData }`
- **`onTechHit`**: `{ triggeringToken, techItem, targets: Array<{target, roll, crit}>, ... }`
- **`onTechMiss`**: `{ triggeringToken, techItem, targets: Array<{target, roll}>, ... }`

#### Movement Triggers

**`onPreMove`**
Fires *before* movement is finalized. Allows interception.
```javascript
{
    token: Token,
    distanceToMove: number,
    elevationToMove: number,
    startPos: { x, y },
    endPos: { x, y },
    isDrag: boolean,
    moveInfo: {
        isInvoluntary: boolean,
        isTeleport: boolean,
        pathHexes: Array<Object> // [{x, y, cx, cy, isHistory, hexes}]
    },
    cancel: Function(),
    cancelTriggeredMove: Function(reason?, showCard?),
    changeTriggeredMove: Function(pos, extraData?, reason?, showCard?)
}
```

- **`onMove`**: Fires when movement completes.
    ```javascript
    {
        triggeringToken: Token,
        distanceMoved: number,
        elevationMoved: number,
        startPos: { x, y },
        endPos: { x, y },
        isDrag: boolean,
        moveInfo: {
            isInvoluntary: boolean,
            isTeleport: boolean,
            pathHexes: Array<Object>,
            isBoost: boolean,
            boostSet: Array<number>,
            isModified: boolean,
            extraData: Object
        }
    }
    ```
- **`onKnockback`**: Fires after knockback moves are applied. `{ triggeringToken, range, pushedActors: Actor[], actionName, item }`.
  - `actionName` and `item` are set when `knockBackToken()` is called with those options — enables `onlyOnSourceMatch` matching (e.g. a reaction named `"Grapple"` with `triggers: ["onKnockback"]` and `onlyOnSourceMatch: true` will only fire for grapple-triggered knockbacks).

#### Deployment & Placement Triggers
- **`onDeploy`**: Fires when a deployable or weapon token is placed on the map.
    ```javascript
    {
        triggeringToken: Token,
        item: Item,
        deployedTokens: Array<TokenDocument>,
        deployType: string, // "deployable" | "throw"
        distanceToTrigger: number
    }
    ```

#### Turn Events
- **`onTurnStart`** / **`onTurnEnd`**: `{ triggeringToken }`.
- **`onEnterCombat`** / **`onExitCombat`**: `{ triggeringToken }`. Fires when a token is added to or removed from the combat tracker.

#### Status Effect Triggers
- **`onPreStatusApplied`**: Before a status is applied. `{ triggeringToken, statusId, effect, cancelChange(reasonText, title, showCard, userIdControl) }`. Non-async evaluate only.
- **`onPreStatusRemoved`**: Before a status is removed. `{ triggeringToken, statusId, effect, cancelChange(reasonText, title, showCard, userIdControl) }`. Non-async evaluate only.
- **`onStatusApplied`** / **`onStatusRemoved`**: `{ triggeringToken, statusId, effect }`.

#### Damage & Structure Triggers
- **`onStructure`**: `{ triggeringToken, remainingStructure, rollResult }`.
- **`onStress`**: `{ triggeringToken, remainingStress, rollResult }`.
- **`onHeat`**: `{ triggeringToken, heatGained, currentHeat, inDangerZone }`.
- **`onDestroyed`**: `{ triggeringToken }`.
- **`onHpLoss`**: `{ triggeringToken, hpLost, currentHP }`.
- **`onHPRestored`**: `{ triggeringToken, hpRestored, currentHP, maxHP }`.
- **`onClearHeat`**: `{ triggeringToken, heatCleared, currentHeat }`.

#### Stat & Activation Triggers
- **`onInitCheck`**: Before roll. `{ triggeringToken, statName, checkAgainstToken, targetVal, cancelCheck(reasonText, title, showCard, userIdControl) }`.
- **`onCheck`**: Result. `{ triggeringToken, statName, roll, total, success, checkAgainstToken, targetVal }`.
- **`onInitActivation`**: Before item/action activates (before resource use). `{ triggeringToken, actionType, actionName, item, actionData, cancelAction(reasonText, title, showCard, userIdControl) }`. Non-async evaluate only.
- **`onActivation`**: Item/Action fired. `{ triggeringToken, actionType, actionName, item, actionData, endActivation }`.
- **`onUpdate`**: **WARNING**: Generic document update (High frequency).

---

### Evaluate & Activate Signatures

#### `evaluate(triggerType, triggerData, reactorToken, item, name, api)`
Determines if an activation should trigger. Called for every potential reactor.
- **Returns**: `boolean`.

#### `activationCode(triggerType, triggerData, reactorToken, item, name, api)`
Code to run when activated.
- **Returns**: `Promise<void>`.

#### `onInit(token, item, api)`
Code to run when a token is created on the scene.
- **Returns**: `Promise<void>`.

---

### Activation Object Structure

```javascript
{
    triggers: ["onMove"],        // Array of trigger names
    enabled: true,               // Master toggle
    forceSynchronous: false,     // Wait for resolution (required for onPreMove, onInitActivation, onInitAttack, onInitTechAttack, onInitCheck intercepts)
    triggerDescription: "",      // Header text for the reaction card
    effectDescription: "",       // Body text for the reaction card
    actionType: "Reaction",      // Reaction, Free Action, Quick, Full, Protocol, Other
    frequency: "1/Round",        // Display-only frequency text
    triggerSelf: false,          // Can react to own actions
    triggerOther: true,          // Can react to others
    consumesReaction: true,      // Consumes 1/round reaction resource
    outOfCombat: false,          // Works outside of combat turns
    onlyOnSourceMatch: false,    // Match name (general) or possession (item)
    dispositionFilter: ["hostile"], // hostile, friendly, neutral, secret
    evaluate: "return true;",    // Code string or Function
    activationType: "code",      // code, flow, macro, none
    activationMode: "after",     // after (run after flow) or instead (replace flow)
    activationCode: "",          // Code string or Function
    activationMacro: "",         // Macro name
    autoActivate: false          // Skip popup, run immediately
}
```

---

### Consumption Object Structure

```javascript
{
    trigger: "onDamage",         // Required: trigger name that consumes a charge
    originId: "tokenId",         // Only consume if this token is involvevd
    stack: 1,                    // Charges to remove per trigger
    grouped: true,               // Shared counter across all effects in this call
    groupId: "customId",         // Shared ID across calls
    evaluate: null,              // (type, data, token, effect) => boolean
    itemLid: "weapon_lid",       // filter by item source
    actionName: "Skirmish",      // filter by action name
    isBoost: false,              // consume only on boost tokens
    minDistance: 1,              // distance filter
    checkType: "Agility",        // stat filter
    checkAbove: 10,              // threshold
    checkBelow: 5                // threshold
}
```

---

## Combat & Execution Flows

#### `executeStatRoll(actor, stat, title, target, extraData)`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `actor` | `Actor` | *required* | The actor making the roll |
| `stat` | `string` | *required* | `"HULL"`, `"AGI"`, `"SYS"`, `"ENG"`, `"GRIT"` |
| `title` | `string` | auto | Roll title |
| `target` | `number\|"token"`| `10` | Pass threshold or `"token"` for interactive choice |
| `extraData` | `Object` | `{}` | Extra data: `{ targetStat: "HULL" }` to use a different stat for difficulty lookup |

**Returns:** `{ completed: boolean, total: number, roll: Roll, passed: boolean }`

---

#### `executeDamageRoll(attacker, targets, damageValue, damageType, title, options, extraData)`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `attacker` | `Token\|Actor`| *required* | The attacker |
| `targets` | `Array<Token>` | *required* | Damage targets |
| `damageValue` | `number` | *required* | Base damage |
| `damageType` | `string` | *required* | kinetic, energy, explosive, burn, heat, variable |
| `title` | `string` | `"Damage Roll"`| Roll title |
| `options`   | `Object` | `{}` | Flow options (see below) |
| `extraData`   | `Object` | `{}` | Injected state data |

**`options` Object:**
`{ ap, paracausal, overkill, reliable, half_damage, add_burn, invade, has_normal_hit, has_crit_hit, tags, bonus_damage, hit_results }`

**Returns:** `{ completed: boolean, flow: Flow }`

---

#### `executeBasicAttack(actor, options, extraData)`
#### `executeTechAttack(actor, options, extraData)`
- **Returns**: `Promise<{ completed: boolean, flow: Flow }>`

---

#### `executeSimpleActivation(actor, options, extraData)`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `title` | `string` | `""` | Card/Match title |
| `action` | `Object` | `null` | `{ name, activation }` |
| `detail` | `string` | `""` | Description text |
| `tags` | `Array` | `[]` | Lancer tags |

**Returns:** `Promise<{ completed: boolean, flow: Flow }>`

---

## Effect Management

#### `applyEffectsToTokens(options, extraOptions)`

**`options` Object:**
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `tokens` | `Array<Token>`| *required* | Targets |
| `effectNames`| `string\|Array`| *required* | "prone" or `{ name, icon, isCustom }` |
| `note` | `string` | `undefined` | Flavor note |
| `duration` | `Object` | `undefined` | `{ label, turns, rounds, overrideTurnOriginId }` — when `overrideTurnOriginId` is set, duration ticks down from that token's turn instead of the target's |
| `checkEffectCallback`| `fn`| `null`| Duplicate check predicate |
| `notify` | `bool\|obj`| `true`| Unified notification config |

**`extraOptions` Object:**
`{ stack, linkedBonusId, consumption, statDirect, changes, ...customFlags }`

Any additional key-value pairs in `extraOptions` (e.g. `suppressSourceId`, `suppressSourceName`) are stored verbatim inside `flags['lancer-automations']` on each created effect. These can later be used as removal filters via `extraFlags` in `removeEffectsByNameFromTokens`.

**Returns:** `Promise<Array<Token>>`

---

#### `removeEffectsByNameFromTokens(options)`

Finds all effects matching the given name(s) and removes them. This is a **find-by-name-and-delete-all-matches** operation — it removes every effect whose name matches, not a targeted removal by ID. To delete a specific known effect by ID, use [`deleteEffect`](#deleteeffecttoken-effect) instead.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `tokens` | `Array<Token>` | *required* | Tokens to remove from |
| `effectNames` | `string\|Array` | *required* | Effect name(s) to match and remove |
| `originId` | `string` | `null` | Only remove effects whose stored `originID` flag matches this value |
| `extraFlags` | `Object` | `null` | Key/value pairs that must ALL match the effect's `flags['lancer-automations']` data. Use this to target effects by custom flags stored via `extraOptions` at apply time (e.g. `{ suppressSourceId: reactorToken.id }`) |
| `notify` | `bool\|Object` | `true` | Notification config |

> **Note:** `originId` and `extraFlags` are independent filters — both are applied when provided. Use `extraFlags` when the source identity was stored as a custom flag (not as `originID`).

**Returns:** `Promise<Array<Token>>`

**Example — remove only this archer's suppress effects:**
```javascript
await api.removeEffectsByNameFromTokens({
    tokens: [targetToken],
    effectNames: ["Suppress", "impaired"],
    extraFlags: { suppressSourceId: reactorToken.id }
});
```

#### `deleteEffect(token, effect)`

Deletes a specific active effect by object or ID. Unlike `removeEffectsByNameFromTokens`, this targets one exact effect — no name matching, no side effects. Routes through the GM socket automatically for non-GM users.

| Parameter | Type | Description |
|-----------|------|-------------|
| `token` | `Token\|TokenDocument\|string` | The token (or its ID) that owns the effect |
| `effect` | `ActiveEffect\|string` | The effect (or its ID) to delete |

```javascript
const effects = api.getAllEffects(target);
// Let user pick one, then delete exactly that effect:
api.deleteEffect(target, effects[0]);
```

#### `findEffectOnToken(token, identifier)`
- **Returns**: `ActiveEffect | undefined` (Search by string name or predicate function)

#### `getAllEffects(target)`
- **Returns**: `Array<ActiveEffect>` — all active effects on the target, including unflagged player-added ones.

#### `consumeEffectCharge(effect)`
- **Returns**: `Promise<boolean>`

#### `triggerEffectImmunity(token, effectNames, source, notify)`
- **Returns**: `Promise<void>` (Removes effects and announces immunity in chat)

#### `checkEffectImmunities(actor, effectName)`
- **Returns**: `Array<string>` — returns an array of source names (e.g. ["Immunity Bonus", "Armor Plating"]) if the actor is immune to the named effect.

#### `deleteAllEffects(tokens)`
Removes **all** active effects from the provided tokens.
- **tokens**: `Array<Token|TokenDocument>` (Required)
- **Returns**: `Promise<void>`

#### `executeEffectManager(options)`
- Opens the Effect Manager UI.

---

## Global & Constant Bonuses

#### `addGlobalBonus(actor, bonusData, options)`

**`bonusData` Object:**
| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Optional custom ID |
| `name` | `string` | Display name |
| `type` | `string` | `"accuracy"`, `"difficulty"`, `"damage"`, `"stat"`, `"immunity"`, `"tag"`, `"range"`, `"multi"` |
| `subtype` | `string` | Only for `type: "immunity"`. `"effect"`, `"damage"`, `"resistance"`, `"crit"`, `"hit"`, `"miss"` |
| `effects` | `Array` | Only for `subtype: "effect"`. List of effect/status names (e.g. `["Prone", "Immobilized"]`) |
| `damageTypes` | `Array` | Only for `subtype: "damage"` or `"resistance"`. List of damage types (e.g. `["Energy", "Kinetic"]`) |
| `tagName` | `string` | Only for `type: "tag"`. Name of the custom tag being added (e.g. `"Inaccurate"`) |
| `val` | `number\|string`| Value for stat, accuracy, difficulty, tag, or range bonuses |
| `tagMode` | `string` | `"add"`, `"override"`. For `type: "tag"`. Determines if the tag adds to a value or overrides it. |
| `removeTag` | `boolean` | For `type: "tag"`. If true, negates the tag instead of adding it. |
| `rangeType` | `string` | Only for `type: "range"`. The range category to modify: `"Range"`, `"Threat"`, `"Line"`, `"Blast"`, `"Burst"`, `"Cone"` |
| `rangeMode` | `string` | Only for `type: "range"`. `"add"` (default) or `"override"` |
| `bonuses` | `Array` | Only for `type: "multi"`. Array of sub-bonus objects to be grouped under this single bonus entry. |
| `uses` | `number` | Stack count |
| `stat` | `string` | Property path (e.g. `system.hp.max`) |
| `rollTypes` | `Array` | `["attack"]`, `["check"]`, etc. |
| `condition` | `string\|fn` | `(state, actor, data, context) => boolean` |
| `itemLids` | `Array` | LID filters |
| `applyTo` | `Array` | Token ID filters |
| `damage` | `Array` | Damage bonus: `[{ type, val }]` |

**`options` Object:**
`{ duration ("indefinite"|"end"|"start"), durationTurns, origin, consumption }`

**Returns:** `string` (Bonus ID)

---

#### `removeGlobalBonus(actor, bonusId, skipEffectRemoval)`
#### `getGlobalBonuses(actor)`
#### `addConstantBonus(actor, bonusData)`
#### `getConstantBonuses(actor)`
#### `removeConstantBonus(actor, bonusId)`

### Flow State Data Injection

When within an active flow (like an attack, a check, etc.), the `triggerData` parameter contains a `flowState` object. You can use this state object to inject ephemeral bonuses or share arbitrary variables across triggers for the lifespan of that specific flow.

#### `triggerData.flowState.injectBonus(bonus)`
Adds an ephemeral bonus to the current flow (e.g., an accuracy bonus). The bonus applies to rolls during this flow and is discarded when the flow completes.

#### `triggerData.flowState.injectFlowExtraData(extraData)`
Merges the properties of `extraData` into `state.la_extraData`. Useful for passing variables between different trigger phases (e.g., from `onHit` to `onDamage`).

#### `triggerData.flowState.getFlowExtraData()`
Returns the `la_extraData` object attached to the current flow state.

#### `getImmunityBonuses(actor, subtype)`
- **Returns**: `Array<object>` — returns all immunity bonuses of the specified subtype (`"effect"`, `"damage"`, `"resistance"`, `"crit"`, `"hit"`, `"miss"`) for the actor.

#### `applyDamageImmunities(actor, damages)`
- **Returns**: `Array<object>` — takes an array of damage objects `{type, val}` and returns a new array where immune types are zeroed out.

#### `hasCritImmunity(actor)`
- **Returns**: `boolean` — returns true if the actor has any "crit" subtype immunity bonuses.

#### `hasHitImmunity(actor)`
- **Returns**: `boolean` — returns true if the actor has any "Hit" subtype immunity bonuses.

#### `hasMissImmunity(actor)`
- **Returns**: `boolean` — returns true if the actor has any "Miss" subtype immunity bonuses.

---

## Spatial & Distance Tools

#### Distance Calculations
- **`getTokenDistance(t1, t2)`**: Grid distance in spaces.
- **`getMinGridDistance(t1, t2, overridePos1)`**: Shortest grid path, natively accounting for size and shape.
- **`getGridDistance(p1, p2)`**: Pixel-to-grid conversion.

#### Faction & Disposition
- **`isHostile(t1, t2)`**: Checks disposition (Faction compatible).
- **`isFriendly(t1, t2)`**: Checks disposition.

#### Grid & Cell Data
- **`getTokenCells(token)`**: Array of `[x,y]` coordinates occupied.
- **`getMaxGroundHeightUnderToken(token, terrainAPI)`**: Highest height value under any cell.

#### Debug Visualizations
- **`drawThreatDebug(token)`**: Draw threat cells (Hex only).
- **`drawDistanceDebug()`**: Select 2 tokens to display distance.
- **`drawRangeHighlight(token, range, color, alpha)`**: Returns PIXI Graphics.

---

## Weapon & Item Details

These functions provide processed information about weapons and items, often accounting for active actor bonuses (e.g., Accuracy, Threat bonuses).

#### `getItemTags_WithBonus(item, actor)`

Returns the effective tag list for a single item, with actor bonuses applied.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `item` | `Item` | *required* | The item to inspect |
| `actor` | `Actor` | `item.parent` | The actor whose bonuses should be applied |

**Returns:** `Promise<Array<Object>>` (Array of Lancer tags)

---

#### `getActorMaxThreat(actor)`

Returns the highest Threat range across all weapons held by the actor, accounting for active bonuses.

| Parameter | Type | Description |
|-----------|------|-------------|
| `actor` | `Actor` | The actor to inspect |

**Returns:** `Promise<number>`

---

#### `getMaxWeaponRanges_WithBonus(input)`

Returns the maximum range value per range type across all weapons provided in the input.

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `Actor\|Token\|Item\|Array` | The source(s) to scan for weapons |

**Returns:** `Promise<Object>` — e.g., `{ Range: 25, Burst: 3 }`

---

#### `getMaxWeaponReach_WithBonus(input)`

Returns the single highest reach value across all scanned weapons. Scans `Range`, `Threat`, `Line`, `Burst`, and `Cone` (ignores `Blast`). Also accounts for the `tg_thrown` tag.

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `Actor\|Token\|Item\|Array` | The source(s) to scan for weapons |

**Returns:** `Promise<number>`

---

#### `getWeaponType(item)`

Returns the weapon subtype string (e.g. `"Superheavy Rifle"`, `"Melee"`). **Note:** This is synchronous and does not apply bonuses.

| Parameter | Type | Description |
|-----------|------|-------------|
| `item` | `Item` | The weapon item |

**Returns:** `string`

---

#### `getItemType(item)`

Returns the Lancer item type string (e.g. `"Weapon"`, `"System"`, `"mech_weapon"`).

| Parameter | Type | Description |
|-----------|------|-------------|
| `item` | `Item` | The item to inspect |

**Returns:** `string`

---

## Interactive Player Tools

#### `chooseToken(casterToken, options)`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `range` | `number` | `null` | Max range highlight |
| `count` | `number` | `1` | Targets to pick (-1 for unlimited) |
| `filter` | `Function` | `null` | `(token) => boolean` |
| `includeHidden`| `boolean`| `false`| Include hidden tokens |
| `includeSelf`| `boolean`| `false` | Is the caster selectable? |
| `title` | `string` | `"SELECT TARGETS"` | Card header |
| `description`| `string` | `""` | Card description |
| `icon` | `string` | `"fas fa-crosshairs"`| FontAwesome icon |
| `headerClass`| `string` | `""` | Extra CSS class |

---

#### `placeZone(casterToken, options)`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `range` | `number` | `null` | Max range highlight |
| `size` | `number` | `1` | Zone size |
| `type` | `string` | `"Blast"` | "Blast", "Burst", "Cone", "Line" |
| `fillColor` | `string` | `"#ff6400"`| Template color |
| `borderColor`| `string` | `"#964611ff"`| Template border |
| `texture` | `string` | `null` | Optional texture path |
| `count` | `number` | `1` | Number of zones (-1 for unlimited) |
| `hooks` | `Object` | `{}` | templatemacro hooks (see trigger list below) |
| `dangerous` | `Object` | `null` | Shortcut: `{ damageType, damageValue }` — triggers ENG check on entry/turn start, deals damage on failure |
| `statusEffects` | `Array` | `[]` | Shortcut: status effect IDs applied to tokens inside (e.g. `["impaired", "lockon"]`) |
| `difficultTerrain` | `Object` | `null` | Shortcut: `{ movementPenalty, isFlatPenalty }` — sets ElevationRuler movement cost on the template |
| `centerLabel` | `string` | `""` | Text rendered at the center of the template on canvas |
| `title` | `string` | `"PLACE ZONE"` | Card header |

**Custom Logic via `hooks`:**
The `hooks` object allows you to attach custom logic to template events. Each hook entry supports two formats that can be used independently or combined:

| Format | Description |
|--------|-------------|
| `{ command: string, asGM: boolean }` | A string of Javascript code stored in template flags (persists across reloads) |
| `{ function: Function, asGM: boolean }` | A direct Javascript function stored in a runtime registry (lost on reload) |

Both formats **stack** — if you provide both `command` and `function` for the same trigger, both will run.

- **Trigger List:** `created`, `deleted`, `moved`, `hidden`, `revealed`, `entered`, `left`, `through`, `staying`, `turnStart`, `turnEnd`.
- **Available Variables:** Both `command` strings and `function` callbacks receive:
    - `template` — The `MeasuredTemplateDocument` being triggered.
    - `scene` — The current Scene document.
    - `token` — The token that triggered the event (if applicable, e.g. for `entered`/`left`).
    - `context` — Additional context (e.g. `gmId`, `userId`, `coords`). In `command` strings this is available as `this`.

**Example — String Command:**
```javascript
api.placeZone(token, {
    size: 2,
    hooks: {
        entered: {
            command: "console.log(`${token.name} entered the zone!`);",
            asGM: true
        }
    }
});
```

**Example — Direct Function:**
```javascript
api.placeZone(token, {
    size: 2,
    hooks: {
        entered: {
            function: (template, scene, token, context) => {
                if (!token?.actor) return;
                const api = game.modules.get('lancer-automations').api;
                api.applyEffectsToTokens({ tokens: [token], effectNames: ["impaired"] });
            },
            asGM: true
        },
        left: {
            function: (template, scene, token, context) => {
                if (!token?.actor) return;
                const api = game.modules.get('lancer-automations').api;
                api.removeEffectsByNameFromTokens({ tokens: [token], effectNames: ["impaired"] });
            },
            asGM: true
        }
    }
});
```

**Zone type examples:**
```js
// Dangerous zone — ENG check on entry/turn start, damage on failure
placeZone(token, { size: 2, dangerous: { damageType: "kinetic", damageValue: 5 } });

// Status effect zone — applies effects to tokens inside
placeZone(token, { size: 2, statusEffects: ["impaired", "lockon"] });

// Difficult terrain — movement penalty via ElevationRuler
placeZone(token, { size: 2, difficultTerrain: { movementPenalty: 1, isFlatPenalty: true } });
```

---

#### `placeToken(options)`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `actor` | `Actor\|Array` | `null` | Single Actor, Array of Actors, or Array of `{actor, extraData}` objects. When an array is passed, the card shows an actor selector. |
| `range` | `number` | `null` | Placement range |
| `count` | `number` | `1` | Total tokens to place |
| `extraData` | `Object` | `{}` | Default token data overrides. Per-entry `extraData` merges on top. Flags are shallow-merged with prototype flags. |
| `origin` | `Token\|{x,y}`| `null` | Measurement origin |
| `onSpawn` | `Function`| `null` | `(newTokenDoc, origin) => {}` |
| `title` | `string` | `"PLACE TOKEN"` | Card header |
| `noCard` | `boolean`| `false` | Skip info card |

---

#### `knockBackToken(tokens, distance, options)`
Interactive tool to apply knockback. Shows visual traces and requires confirmation.

#### `revertMovement(token, destination)`
Reverts a token's movement history by one step.

#### `pickItem(items, options)`

Prompts the user to pick an item from a list of items using a Choice Card.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `items` | `Array<Item>`| *required* | Array of items to choose from |
| `title` | `string` | `"PICK ITEM"` | Card title |
| `description`| `string` | `"Select an item:"`| Subtitle text |
| `icon` | `string` | `"fas fa-box"`| FontAwesome class |
| `formatText` | `Function` | `null` | Optional function to format text: `(item) => item.name` |

**Returns:** `Promise<Item|null>` (the selected item, or null if cancelled)

---

#### `getWeapons(entity)`

Returns an array of all weapon, mech_weapon, and npc_feature (Weapon) items on an actor.

**Returns:** `Array<Item>`

---

#### `reloadOneWeapon(actorOrToken, targetName?)`

Prompts to select and reload an unloaded Loading weapon on an actor.

**Returns:** `Promise<Item|null>`

---

#### `rechargeSystem(actorOrToken, targetName?)`

Prompts to select a depleted system and restores it. Targets `mech_system`, `pilot_gear`, and NPC non-weapon features with `tg_limited` (uses ≤ 0) or `tg_recharge` (`charged === false`).

**Returns:** `Promise<Item|null>`

**Example:**
```js
await api.rechargeSystem(reactorToken);
```

---

#### `findAura(actorOrToken, auraName)`

Finds a Grid-Aware Aura configuration on an actor by its name.

**Returns:** `object|null`

---

#### `findItemByLid(actorOrToken, lid)`

Finds an item on an actor by its Lancer ID (lid).

**Returns:** `Item|null`

---

#### `startChoiceCard(options)`

Presents a choice card to the user (or GM) with custom buttons and callbacks.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `mode` | `string` | `"or"` | `"or"` (pick one, close), `"and"` (must confirm all), `"vote"` (multi-user vote, creator sees live tally), `"vote-hidden"` (tally hidden until creator confirms) |
| `choices` | `Array` | `[]` | List of choice objects (see below) |
| `title` | `string` | `"CHOICE"` | Card header title |
| `description`| `string` | `""` | Subtitle text |
| `icon` | `string` | `null` | FontAwesome class (e.g. `"fas fa-shield-alt"`) |
| `headerClass`| `string` | `""` | Optional CSS class for the header |
| `userIdControl` | `string\|string[]\|null` | `null` | Single userId, array of userIds (vote/broadcast targets), or null (show locally). For vote modes this is the list of voters. |

**Choice Object Structure:**
```javascript
{
    text: "Button Label",
    icon: "fas fa-check",       // Optional icon
    data: { id: 1 },            // Arbitrary data passed to callback
    callback: async (data) => { // Logic to run when selected (or when creator confirms in vote mode)
        console.log(data.id);
    }
}
```

**Vote mode notes:**
- `"vote"`: voters see a live running tally as votes arrive. The creator sees all votes in real time and manually confirms the winner.
- `"vote-hidden"`: voters cannot see each other's choices until the creator confirms. Creator always sees the full tally.
- `userIdControl` must be a non-empty array of user IDs when using vote modes.
- When the creator confirms, the winning choice's `callback` is called.

**Returns:** `Promise<true|null>` (true on completion, null if cancelled)

---

#### `openChoiceMenu()`

Opens a GM-facing wizard dialog to configure and broadcast a choice card or vote to one or more active users.

- **Returns:** `Promise<void>`

**Modes available in the dialog:**

| Mode | Behavior |
|------|----------|
| **Vote** | Each selected recipient gets a vote card. The GM sees a live tally as responses arrive, then manually picks the winner. Result is posted to chat. |
| **Hidden Vote** | Same as Vote, but voters cannot see each other's selections until the GM confirms. Useful to avoid bandwagon effects. |
| **Pick One (OR)** | First player to click wins. Other cards are dismissed automatically. |
| **Pick All (AND)** | Every recipient must confirm their own card before the flow resolves. |

**Dialog options:**
- **Title / Description**: text shown on the card sent to players
- **Recipients**: click to toggle which active users receive the card
- **Options**: free-text list of choices (auto-numbered)

When the vote concludes or a pick-one is selected, a styled chat message is posted with the result.

**Macro Example:**
```javascript
game.modules.get('lancer-automations').api.openChoiceMenu();
```

**Use case — player vote:**
Run `openChoiceMenu()` from a macro, set the mode to **Vote**, select the players, add the options, and click Send. Each player sees a vote card. The GM watches the tally fill in live and clicks Confirm to lock the result. A chat message announces the winner.

```javascript
// Shortcut macro (add to hotbar)
game.modules.get('lancer-automations').api.openChoiceMenu();
```

---

## Deployment & Thrown Weapons

#### `addItemFlags(item, flags)`
Persists lancer-automations flags onto a Foundry Item document. These flags are read back automatically by `placeDeployable` when the item is passed as `systemItem`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `item` | `Item` | The Foundry Item document to update |
| `flags` | `Object` | Key/value pairs to set under `flags['lancer-automations']` |

**Returns:** `Promise<Item>` — the updated item.

**Known flag keys:**

| Key | Type | Used by | Description |
|-----|------|---------|-------------|
| `deployRange` | `number` | `placeDeployable` | Default placement range for this item's deployables |
| `deployCount` | `number` | `placeDeployable` | Default number of deployables to place |

**Example:**
```js
// Set deploy range 5 and deploy count 2 on a system item
await api.addItemFlags(myItem, { deployRange: 5, deployCount: 2 });

// Now placeDeployable will use range=5 and count=2 automatically
await api.placeDeployable({ deployable: lid, ownerActor: actor, systemItem: myItem });
```

---

#### `addExtraDeploymentLids(item, lids)`
Adds extra deployable LIDs to an item via flags (`lancer-automations.extraDeployables`).
Since Lancer's TypeDataModel prevents writing to `system.deployables` on NPC features,
this stores extra LIDs as flags that are merged in by `getItemDeployables`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `item` | `Item` | The Foundry Item document to update |
| `lids` | `string\|Array<string>` | A single LID string or array of LID strings to add |

**Returns:** `Promise<Item>` — the updated item.

**Example:**
```js
await api.addExtraDeploymentLids(myNpcFeature, ["dep_turret_t1", "dep_turret_t2", "dep_turret_t3"]);
```

---

#### `addExtraActions(target, actions)`
Adds extra action objects via flags (`lancer-automations.extraActions`). Accepts an Item, Token, or Actor. Items store on the item; tokens/actors store on the actor.

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `Item\|Token\|Actor` | The document to update |
| `actions` | `Object\|Array<Object>` | A single action object or array of action objects to add |

**Returns:** `Promise<Item|Actor>`

**Example:**
```js
await api.addExtraActions(myItem, { name: "Suppressive Fire", activation: "Quick", detail: "..." });
await api.addExtraActions(myToken, { name: "Custom Strike", activation: "Quick", detail: "..." });
```

---

#### `getItemActions(item)`
Returns the effective actions for an item, merging `system.actions` with any extras stored via `addExtraActions`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `item` | `Item` | The item document |

**Returns:** `Object[]`

---

#### `getActorActions(tokenOrActor)`
Returns extra actions stored on an actor/token via `addExtraActions`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `tokenOrActor` | `Token\|Actor` | The token or actor to read from |

**Returns:** `Object[]`

---

#### `removeExtraActions(target, filter?)`
Removes extra actions from an item, token, or actor.

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `Item\|Token\|Actor` | The document to update |
| `filter` | `Function\|string\|string[]\|null` | Predicate, action name, array of names, or null to clear all |

**Returns:** `Promise<void>`

**Example:**
```js
await api.removeExtraActions(myToken, "Custom Strike");   // by name
await api.removeExtraActions(myItem, a => a.activation === "Quick"); // by predicate
await api.removeExtraActions(myToken);                    // clear all
```

---

#### `getItemDeployables(item, actor)`
Returns the effective deployable LIDs for an item, merging `system.deployables` with
extra LIDs from the `lancer-automations.extraDeployables` flag. For NPC actors, applies
tier-based selection (1 entry = same for all tiers, 3 entries = pick by tier).

| Parameter | Type | Description |
|-----------|------|-------------|
| `item` | `Item` | The item document |
| `actor` | `Actor` | Optional. The owner actor (needed for NPC tier selection) |

**Returns:** `string[]` — array of deployable LID strings.

**Example:**
```js
const lids = api.getItemDeployables(myItem, myActor);
```

---

#### `getItemFlags(item, flagName)`
Retrieves lancer-automations flags from a Foundry Item document.

| Parameter | Type | Description |
|-----------|------|-------------|
| `item` | `Item` | The Foundry Item document to read from |
| `flagName` | `string` | Optional. Specific flag key to retrieve. If null, returns all module flags. |

**Returns:** `any` — the value of the requested flag, or an object containing all flags.

**Example:**
```js
// Get all flags
const allFlags = api.getItemFlags(myItem);

// Get a specific flag
const range = api.getItemFlags(myItem, 'deployRange');
```

---

#### `placeDeployable(options)`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `deployable` | `Actor\|string\|Array`| *req* | LID, Actor, or array of LIDs/Actors. Array shows actor selector. |
| `ownerActor` | `Actor` | *req* | Owner |
| `systemItem` | `Item` | `null` | Parent item |
| `consumeUse` | `boolean` | `false` | Consumes system use |
| `fromCompendium`| `boolean`| `false` | Creates new actor if not in world |
| `width` | `number` | `null` | Width override |
| `height` | `number` | `null` | Height override |
| `range` | `number` | `1` | Placement range (if `systemItem` has a `deployRange` flag, that is used instead) |
| `count` | `number` | `1` | Total to place (if `systemItem` has a `deployCount` flag, that is used instead) |
| `at` | `Token\|pos`| `null` | Measurement origin |
| `title` | `string` | `"DEPLOY"` | Card title |
| `noCard` | `boolean` | `false` | Auto-confirm |

---

#### `beginDeploymentCard(options)`
Resolves all deployable LIDs on an item and opens a single `placeDeployable` session with actor selector.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `actor` | `Actor` | *required* | The owner actor |
| `item` | `Item` | *required* | The item (system/frame) with deployables |
| `deployableOptions` | `Array` | `[]` | Per-index options (e.g. `[{ range: 3, count: 2 }]`) |

#### `deployWeaponToken(weapon, ownerActor, originToken, options)`
Deploys a weapon as a token on the map (for thrown weapons).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `weapon` | `Item` | *required* | The weapon to deploy |
| `ownerActor` | `Actor` | *required* | The actor throwing it |
| `originToken` | `Token` | `null` | Measurement origin |
| `options` | `Object`| `{}` | Supports `range`, `count`, `description` |

#### `openDeployableMenu(actor)` / `recallDeployable(ownerToken)`
#### `pickupWeaponToken(ownerToken)` / `openThrowMenu(actor)`
#### `openItemBrowser(targetInput)`

#### `addItemTag(item, tagData)`
Adds a tag to an item. If a tag with the same `id` exists, it updates it.

| Parameter | Type | Description |
|-----------|------|-------------|
| `item` | `Item` | The Foundry Item document to modify |
| `tagData` | `Object` | The tag object (e.g. `{ id: "tg_heat_self", val: "2" }`) |

**Returns:** `Promise<Item>` — the updated item.

#### `removeItemTag(item, tagId)`
Removes a tag from an item by its ID.

| Parameter | Type | Description |
|-----------|------|-------------|
| `item` | `Item` | The Foundry Item document to modify |
| `tagId` | `string` | The ID of the tag to remove (e.g. `"tg_heat_self"`) |

**Returns:** `Promise<Item>` — the updated item.

---

## Movement Tracking

These functions accept either a string `tokenId` or a `Token` document/object.

- **`clearMoveData(tokenOrId)`**
- **`getCumulativeMoveData(tokenOrId)`**
- **`getIntentionalMoveData(tokenOrId)`**
- **`clearMovementHistory(tokens, revert)`**
- **`getMovementHistory(tokenOrId)`**
  Returns an object detailing the token's movement history in the current turn:
  ```javascript
  {
      exists: boolean,
      totalMoved: number,
      intentional: {
          total: number,
          regular: number,
          free: number
      },
      unintentional: number,
      nbBoostUsed: number,
      startPosition: { x, y },
      movementCap: number   // max movement allowed this turn; set at turn start to actor speed (0 if immobilized)
  }
  ```

- **`increaseMovementCap(tokenOrId, value)`**
  Adds `value` to the token's movement cap for the current turn. Used by the Boost general reaction to grant extra movement.

---

## Registration & Logic

### User Helpers

#### `registerUserHelper(name, fn)`
Registers a custom utility function that can be retrieved globally. Useful for sharing logic between separate activation scripts.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Unique name for the helper |
| `fn` | `Function` | The function to register |

#### `getUserHelper(name)`
Retrieves a previously registered helper function by name.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Name of the helper to retrieve |

**Returns:** `Function|null`

### Registration Functions

#### `registerDefaultItemReactions(reactions)`
Registers reaction logic for specific item LIDs.
- **reactions**: Object mapping LIDs to activation objects.

#### `registerDefaultGeneralReactions(reactions)`
Registers global reactions that aren't tied to a specific item.
- **reactions**: Object mapping names to activation objects.

#### How-To: Register Activations

```javascript
Hooks.on('lancer-automations.ready', (api) => {
    api.registerDefaultGeneralReactions({
        "Custom Reaction": {
            triggers: ["onDamage"],
            evaluate: (triggerType, data, reactor, item, name, api) => data.target?.id === reactor.id,
            activationCode: async (triggerType, data, reactor, item, name, api) => {
                // ... logic
            }
        }
    });
});
```

#### How-To: Advanced Consumption

**Shared Shield Charges:**
```javascript
await api.applyEffectsToTokens({
    tokens: [target],
    effectNames: ["resistance_kinetic", "resistance_energy"]
}, {
    stack: 3,
    consumption: {
        trigger: "onDamage",
        originId: target.id,
        grouped: true
    }
});
```

---

## Grid-Aware Auras Wrapper

Requires the [Grid-Aware Auras](https://github.com/Wibble199/FoundryVTT-Grid-Aware-Auras) module (or [my fork](https://github.com/Agraael/FoundryVTT-Grid-Aware-Auras)).

#### `api.createAura(owner, auraConfig)`

Creates an aura using the Grid-Aware Auras module. This wrapper supports passing a Javascript `function` instead of a macro ID.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `owner` | `Token\|Item` | *required* | The document that owns the aura |
| `auraConfig` | `Object` | *required* | Full Grid-Aware Auras configuration object |

**`macros` Function Example:**
```javascript
macros: [{
    mode: "ENTER_LEAVE",
    function: (token, parent, aura, options) => {
        if (options.hasEntered) console.log(`${token.name} entered the aura!`);
    }
}]
```

**Available Trigger Modes:**

| Category | Modes |
|----------|-------|
| **Macro Modes** | `ENTER_LEAVE`, `ENTER`, `LEAVE`, `PREVIEW_ENTER_LEAVE`, `PREVIEW_ENTER`, `PREVIEW_LEAVE`, `OWNER_TURN_START_END`, `OWNER_TURN_START`, `OWNER_TURN_END`, `TARGET_TURN_START_END`, `TARGET_TURN_START`, `TARGET_TURN_END`, `ROUND_START_END`, `ROUND_START`, `ROUND_END`, `TARGET_START_MOVE`, `TARGET_END_MOVE` |
| **Effect Modes** | `APPLY_WHILE_INSIDE`, `APPLY_ON_ENTER`, `APPLY_ON_LEAVE`, `APPLY_ON_OWNER_TURN_START`, `APPLY_ON_OWNER_TURN_END`, `APPLY_ON_TARGET_TURN_START`, `APPLY_ON_TARGET_TURN_END`, `APPLY_ON_ROUND_START`, `APPLY_ON_ROUND_END`, `REMOVE_WHILE_INSIDE`, `REMOVE_ON_ENTER`, `REMOVE_ON_LEAVE`, `REMOVE_ON_OWNER_TURN_START`, `REMOVE_ON_OWNER_TURN_END`, `REMOVE_ON_TARGET_TURN_START`, `REMOVE_ON_TARGET_TURN_END`, `REMOVE_ON_ROUND_START`, `REMOVE_ON_ROUND_END` |

---

#### `api.deleteAuras(owner, filter, options)`

Deletes auras from the specified owner. Safely cleans up any associated lambda callbacks generated by `createAura` from memory.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `owner` | `Token\|Item` | *required* | The document that owns the auras |
| `filter` | `string\|Object` | *required* | String ID, name, or Object filter |
| `options` | `Object` | `{}` | Internal Grid-Aware Auras delete options |
