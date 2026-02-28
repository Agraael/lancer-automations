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
  - [`applyFlaggedEffectToTokens`](#applyflaggedeffecttotokensoptions-extraoptions)
  - [`removeFlaggedEffectToTokens`](#removeflaggedeffecttotokensoptions)
  - [`findFlaggedEffectOnToken`](#findflaggedeffectontokentoken-identifier)
  - [`consumeEffectCharge`](#consumeeffectchargeeffect)
  - [`triggerFlaggedEffectImmunity`](#triggerflaggedeffectimmunitytoken-effectnames-source-notify)
  - [`executeDeleteAllFlaggedEffect`](#executedeleteallflaggedeffect)
  - [`executeEffectManager`](#executeeffectmanageroptions)
- [Global & Constant Bonuses](#global--constant-bonuses)
  - [`addGlobalBonus`](#addglobalbonusactor-bonusdata-options)
  - [`removeGlobalBonus`](#removeglobalbonusactor-bonusid-skipeffectremoval)
  - [`getGlobalBonuses`](#getglobalbonusesactor)
  - [`addConstantBonus`](#addconstantbonusactor-bonusdata)
  - [`getConstantBonuses`](#getconstantbonusesactor)
  - [`removeConstantBonus`](#removeconstantbonusactor-bonusid)
  - [`injectBonusToNextRoll`](#injectbonustonextrollactor-bonus)
- [Spatial & Distance Tools](#spatial--distance-tools)
  - [Distance Calculations](#distance-calculations)
  - [Faction & Disposition](#faction--disposition)
  - [Grid & Cell Data](#grid--cell-data)
  - [Debug Visualizations](#debug-visualizations)
- [Interactive Player Tools](#interactive-player-tools)
  - [`chooseToken`](#choosetokencastertoken-options)
  - [`placeZone`](#placezonecastertoken-options)
  - [`placeToken`](#placetokenoptions)
  - [`knockBackToken`](#knockbacktokentokens-distance-options)
  - [`revertMovement`](#revertmovementtoken-destination)
  - [`startChoiceCard`](#startchoicecardoptions)
- [Deployment & Thrown Weapons](#deployment--thrown-weapons)
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
    - Data: `{ triggeringToken, weapon, targets, actionName, tags, actionData }`
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
- **`onInitTechAttack`**: Before Tech HUD. `{ triggeringToken, techItem, targets, actionName, isInvade, tags, actionData }`
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

#### Turn Events
- **`onTurnStart`** / **`onTurnEnd`**: `{ triggeringToken }`.

#### Status Effect Triggers
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
- **`onInitCheck`**: Before roll. `{ triggeringToken, statName, checkAgainstToken, targetVal }`.
- **`onCheck`**: Result. `{ triggeringToken, statName, roll, total, success, checkAgainstToken, targetVal }`.
- **`onActivation`**: Item/Action fired. `{ triggeringToken, actionType, actionName, item, actionData }`.
- **`onUpdate`**: **WARNING**: Generic document update (High frequency).

---

### Evaluate & Activate Signatures

#### `evaluate(triggerType, triggerData, reactorToken, item, name)`
Determines if an activation should trigger. Called for every potential reactor.
- **Returns**: `boolean`.

#### `activate(triggerType, triggerData, reactorToken, item, name)`
Code to run when activated.
- **Returns**: `Promise<void>`.

---

### Activation Object Structure

```javascript
{
    triggers: ["onMove"],        // Array of trigger names
    enabled: true,               // Master toggle
    forceSynchronous: false,     // Wait for resolution (required for onPreMove intercepts)
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

## Status Effect Management

#### `applyFlaggedEffectToTokens(options, extraOptions)`

**`options` Object:**
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `tokens` | `Array<Token>`| *required* | Targets |
| `effectNames`| `string\|Array`| *required* | "prone" or `{ name, icon, isCustom }` |
| `note` | `string` | `undefined` | Flavor note |
| `duration` | `Object` | `undefined` | `{ label, turns, rounds }` |
| `useTokenAsOrigin`| `boolean`| `true`| Use target as duration origin |
| `customOriginId`| `string`| `null`| Override origin ID |
| `checkEffectCallback`| `fn`| `null`| Duplicate check predicate |
| `notify` | `bool\|obj`| `true`| Unified notification config |

**`extraOptions` Object:**
`{ stack, linkedBonusId, consumption, statDirect, changes, ...customFlags }`

Any additional key-value pairs in `extraOptions` (e.g. `suppressSourceId`, `suppressSourceName`) are stored verbatim inside `flags['lancer-automations']` on each created effect. These can later be used as removal filters via `extraFlags` in `removeFlaggedEffectToTokens`.

**Returns:** `Promise<Array<Token>>`

---

#### `removeFlaggedEffectToTokens(options)`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `tokens` | `Array<Token>` | *required* | Tokens to remove from |
| `effectNames` | `string\|Array` | *required* | Effect name(s) to remove |
| `originId` | `string` | `null` | Only remove effects whose stored `originID` flag matches this value |
| `extraFlags` | `Object` | `null` | Key/value pairs that must ALL match the effect's `flags['lancer-automations']` data. Use this to target effects by custom flags stored via `extraOptions` at apply time (e.g. `{ suppressSourceId: reactorToken.id }`) |
| `notify` | `bool\|Object` | `true` | Notification config |

> **Note:** `originId` and `extraFlags` are independent filters — both are applied when provided. Use `extraFlags` when the source identity was stored as a custom flag (not as `originID`).

**Returns:** `Promise<Array<Token>>`

**Example — remove only this archer's suppress effects:**
```javascript
await api.removeFlaggedEffectToTokens({
    tokens: [targetToken],
    effectNames: ["Suppress", "impaired"],
    extraFlags: { suppressSourceId: reactorToken.id }
});
```

#### `findFlaggedEffectOnToken(token, identifier)`
- **Returns**: `ActiveEffect | undefined` (Search by string name or predicate function)

#### `consumeEffectCharge(effect)`
- **Returns**: `Promise<boolean>`

#### `triggerFlaggedEffectImmunity(token, effectNames, source, notify)`
- **Returns**: `Promise<void>` (Removes effects and announces immunity in chat)

#### `executeDeleteAllFlaggedEffect(tokens, allEffects)`
Removes flagged active effects (those managed by this module) from the provided tokens.
- **tokens**: `Array<Token|TokenDocument>` (Required). The list of tokens to clear.
- **allEffects**: `boolean` (Default `false`). If `true`, removes ALL active effects instead of just flagged ones.
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
| `val` | `number` | Value |
| `type` | `string` | `"accuracy"`, `"difficulty"`, `"damage"`, `"stat"` |
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
#### `injectBonusToNextRoll(actor, bonus)`

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
- **`getActorMaxThreat(actor)`**: Highest Threat range across all weapons.
- **`getTokenCells(token)`**: Array of `[x,y]` coordinates occupied.
- **`getMaxGroundHeightUnderToken(token, terrainAPI)`**: Highest height value under any cell.

#### Debug Visualizations
- **`drawThreatDebug(token)`**: Draw threat cells (Hex only).
- **`drawDistanceDebug()`**: Select 2 tokens to display distance.
- **`drawRangeHighlight(token, range, color, alpha)`**: Returns PIXI Graphics.

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
| `hooks` | `Object` | `{}` | templatemacro hooks |
| `dangerous` | `Object` | `null` | `{ damageValue, damageType }` |
| `statusEffects`| `Array` | `[]` | Effects applied to tokens inside |
| `title` | `string` | `"PLACE ZONE"` | Card header |

---

#### `placeToken(options)`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `actor` | `Actor` | `null` | Linked actor |
| `prototypeToken`| `Object`| *req* | Prototype token data |
| `range` | `number` | `null` | Placement range |
| `count` | `number` | `1` | Number to place |
| `extraData` | `Object` | `{}` | Data injection |
| `origin` | `Token\|{x,y}`| `null` | Measurement origin |
| `onSpawn` | `Function`| `null` | `(newTokenDoc, origin) => {}` |
| `title` | `string` | `"PLACE TOKEN"` | Card header |
| `noCard` | `boolean`| `false` | Skip info card |

---

#### `knockBackToken(tokens, distance, options)`
Interactive tool to apply knockback. Shows visual traces and requires confirmation.

#### `revertMovement(token, destination)`
Reverts a token's movement history by one step.

#### `startChoiceCard(options)`

Presents a choice card to the user (or GM) with custom buttons and callbacks. 
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `mode` | `string` | `"or"` | `"or"` (pick one, close) or `"and"` (must pick all) |
| `choices` | `Array` | `[]` | List of choice objects (see below) |
| `title` | `string` | `"CHOICE"` | Card header title |
| `description`| `string` | `""` | Subtitle text |
| `icon` | `string` | `null` | FontAwesome class (e.g. `"fas fa-shield-alt"`) |
| `headerClass`| `string` | `""` | Optional CSS class for the header |
| `gmControl` | `boolean`| `false` | If true, the card is shown to the GM instead |

**Choice Object Structure:**
```javascript
{
    text: "Button Label",
    icon: "fas fa-check",       // Optional icon
    data: { id: 1 },            // Arbitrary data passed to callback
    callback: async (data) => { // Logic to run when selected
        console.log(data.id);
    }
}
```

**Returns:** `Promise<true|null>` (true on completion, null if cancelled)

---

## Deployment & Thrown Weapons

#### `placeDeployable(options)`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `deployable` | `Actor\|str`| *req* | LID or Actor reference |
| `ownerActor` | `Actor` | *req* | Owner |
| `systemItem` | `Item` | `null` | Parent item |
| `consumeUse` | `boolean` | `false` | Consumes system use |
| `fromCompendium`| `boolean`| `false` | Creates new actor if not in world |
| `width` | `number` | `null` | Width override |
| `height` | `number` | `null` | Height override |
| `range` | `number` | `1` | Placement range |
| `count` | `number` | `1` | Number to place |
| `at` | `Token\|pos`| `null` | Measurement origin |
| `title` | `string` | `"DEPLOY"` | Card title |
| `noCard` | `boolean` | `false` | Auto-confirm |

---

#### `beginDeploymentCard(options)`
Shows an interactive card allowing the user to pick which deployable from an item to place.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `actor` | `Actor` | *required* | The owner actor |
| `item` | `Item` | *required* | The item (system/frame) with deployables |
| `deployableOptions` | `Array` | `[]` | Per-index options overrides for `placeDeployable` |

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

---

## Movement Tracking

- **`clearMoveData(tokenDocId)`**
- **`getCumulativeMoveData(tokenDocId)`**
- **`clearMovementHistory(tokens, revert)`**

---

## Registration & Logic

#### Registration Functions

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
            evaluate: (triggerType, data, reactor) => data.target?.id === reactor.id,
            activationCode: async (type, data, reactor) => {
                // ... logic
            }
        }
    });
});
```

#### How-To: Advanced Consumption

**Shared Shield Charges:**
```javascript
await api.applyFlaggedEffectToTokens({
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
