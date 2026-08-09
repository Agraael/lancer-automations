# Lancer Automations - API Reference

[← Back to the README](../README.md)

## Documentation Files

| File | Contents |
|------|----------|
| **[AUTOMATION_SYSTEM.md](AUTOMATION_SYSTEM.md)** | How the automation engine works: trigger lifecycle, filters, callbacks, activation modes, sockets, cancel/modify, flow injection, registration, caches |
| **[API_COMBAT.md](API_COMBAT.md)** | Combat & execution flows, weapon/item details |
| **[API_SPATIAL.md](API_SPATIAL.md)** | Distance & grid math, coordinate helpers, faction/disposition, cell data, debug overlays |
| **[API_EFFECTS.md](API_EFFECTS.md)** | Status effect management, global/constant bonuses, immunities, flow state injection |
| **[API_INTERACTIVE.md](API_INTERACTIVE.md)** | Token picker, zones, knockback, choice/vote cards, deployables, thrown weapons, hard cover |
| **[API_ITEMS.md](API_ITEMS.md)** | Item & actor flags, tags, resource management, auto-consume config |
| **[API_HUD.md](API_HUD.md)** | Injecting extra actions into the Token Action HUD |
| **[API_MOVEMENT.md](API_MOVEMENT.md)** | Movement tracking, history, movement cap |
| **[API_TOKEN_DISPLAY.md](API_TOKEN_DISPLAY.md)** | Extra token stat bars |
| **[API_HOWTO.md](API_HOWTO.md)** | Registration, user helpers, how-tos, Grid-Aware Auras wrapper |

---

## Accessing the API

```javascript
const api = game.modules.get('lancer-automations').api;
```

Or via hook:
```javascript
Hooks.on('lancer-automations.ready', (api) => {
});
```

---

## Fundamentals

### Trigger Types & Data

Every trigger passes a data object. All objects receive `distanceToTrigger` and `canTriggerReaction` (reactor to triggering token).

#### Attack Triggers

<details><summary><b><code>onInitAttack</code></b> - attack initiated, before Attack HUD</summary>

```js
{
    triggeringToken: Token,
    weapon: Item,
    targets: Array<Token>,
    actionName: string,
    tags: Array,
    actionData: Object,
    cancelAttack: Function(reasonText, title, allowConfirm, userIdControl)
}
```

</details>

<details><summary><b><code>onAttack</code></b> - attack roll made</summary>

```js
{
    triggeringToken: Token,
    weapon: Item,
    targets: Array<Token>,
    attackType: string,
    actionName: string,
    tags: Array,
    actionData: Object
}
```

</details>

<details><summary><b><code>onHit</code></b> - attack hit</summary>

```js
{
    triggeringToken: Token,
    weapon: Item,
    targets: Array<{ target: Token, roll: Roll, crit: boolean }>,
    attackType: string,
    actionName: string,
    tags: Array,
    actionData: Object
}
```

</details>

<details><summary><b><code>onMiss</code></b> - attack missed</summary>

```js
{
    triggeringToken: Token,
    weapon: Item,
    targets: Array<{ target: Token, roll: Roll }>,
    attackType: string,
    actionName: string,
    tags: Array,
    actionData: Object
}
```

</details>

<details><summary><b><code>onPreDamage</code></b> - once per damage roll, before the damage HUD builds</summary>

Mutate `triggerData.flowState.data.damage` or `.bonus_damage` to alter base damage types/values before the player rolls.

```js
{
    triggeringToken: Token,
    weapon: Item,
    targets: Array<Token>,
    attackType: string,
    actionName: string,
    tags: Array,
    actionData: Object,
    flowState: Object
}
```

</details>

<details><summary><b><code>onDamage</code></b> - damage applied</summary>

```js
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

</details>

#### Tech Triggers

<details><summary><b><code>onInitTechAttack</code></b> - before Tech HUD</summary>

```js
{
    triggeringToken: Token,
    techItem: Item,
    targets: Array<Token>,
    actionName: string,
    isInvade: boolean,
    tags: Array,
    actionData: Object,
    cancelTechAttack: Function(reasonText, title, allowConfirm, userIdControl)
}
```

</details>

<details><summary><b><code>onTechAttack</code></b> - tech roll made</summary>

```js
{
    triggeringToken: Token,
    techItem: Item,
    targets: Array<Token>,
    actionName: string,
    isInvade: boolean,
    tags: Array,
    actionData: Object
}
```

</details>

<details><summary><b><code>onTechHit</code></b> - tech attack hit</summary>

```js
{
    triggeringToken: Token,
    techItem: Item,
    targets: Array<{ target: Token, roll: Roll, crit: boolean }>,
    actionName: string,
    isInvade: boolean,
    tags: Array,
    actionData: Object
}
```

</details>

<details><summary><b><code>onTechMiss</code></b> - tech attack missed</summary>

```js
{
    triggeringToken: Token,
    techItem: Item,
    targets: Array<{ target: Token, roll: Roll }>,
    actionName: string,
    isInvade: boolean,
    tags: Array,
    actionData: Object
}
```

</details>

#### Movement Triggers

<details><summary><b><code>onPreMove</code></b> - before movement is finalized</summary>

```js
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
    cancelTriggeredMove: Function(reason?, allowConfirm?),
    changeTriggeredMove: Function(pos, extraData?, reason?, allowConfirm?)
}
```

</details>

<details><summary><b><code>onMove</code></b> - movement completed</summary>

```js
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

</details>

<details><summary><b><code>onInvoluntaryMove</code></b> - before each involuntary per-token move, cancellable</summary>

```js
{
    triggeringToken: Token,
    token: Token,
    distance: number,
    actionName: string,
    item: Item,
    destination: { x: number, y: number },
    cancel: Function(reason?)
}
```

- `cancel(reason?)` synchronously skips this specific token's move; other tokens in the batch still proceed.
- Does **not** fire when `knockBackToken()` is called with `{ asVoluntary: true }` - in that mode the move goes through `onPreMove`/`onMove` like a regular drag.
- `actionName` and `item` are passed from the caller (e.g. `"Grapple"`), used by `onlyOnSourceMatch`.

</details>

#### Deployment & Placement Triggers

<details><summary><b><code>onDeploy</code></b> - deployable or weapon token placed on the map</summary>

```js
{
    triggeringToken: Token,
    item: Item,
    deployedTokens: Array<TokenDocument>,
    deployType: string, // "deployable" | "throw"
    distanceToTrigger: number,
    canTriggerReaction?: boolean
}
```

</details>

#### Turn Events

<details><summary><b><code>onTurnStart</code></b> / <b><code>onTurnEnd</code></b></summary>

```js
{ triggeringToken: Token }
```

</details>

<details><summary><b><code>onRoundStart</code></b> - once at the start of every round, including round 1</summary>

```js
{ combat: Combat, round: number }
```

</details>

<details><summary><b><code>onEnterCombat</code></b> / <b><code>onExitCombat</code></b> - token added to / removed from the combat tracker</summary>

```js
{ triggeringToken: Token }
```

</details>

#### Status Effect Triggers

<details><summary><b><code>onPreStatusApplied</code></b> - before a status is applied (non-async evaluate only)</summary>

```js
{
    triggeringToken: Token,
    statusId: string,
    effect: ActiveEffect,
    cancelChange: Function(reasonText, title, allowConfirm, userIdControl)
}
```

</details>

<details><summary><b><code>onPreStatusRemoved</code></b> - before a status is removed (non-async evaluate only)</summary>

```js
{
    triggeringToken: Token,
    statusId: string,
    effect: ActiveEffect,
    cancelChange: Function(reasonText, title, allowConfirm, userIdControl)
}
```

</details>

<details><summary><b><code>onStatusApplied</code></b> / <b><code>onStatusRemoved</code></b></summary>

```js
{
    triggeringToken: Token,
    statusId: string,
    effect: ActiveEffect
}
```

</details>

#### Structure & Stress Triggers

<details><summary><b><code>onPreStructure</code></b> - before the structure roll, can cancel the flow</summary>

```js
{
    triggeringToken: Token,
    remainingStructure: number,
    cancelStructure: Function(reasonText, title, allowConfirm, userIdControl)
}
```

</details>

<details><summary><b><code>onStructure</code></b> - after the structure roll</summary>

```js
{
    triggeringToken: Token,
    remainingStructure: number,
    rollResult: number
}
```

</details>

<details><summary><b><code>onPreStress</code></b> - before the overheat roll, can cancel the flow</summary>

```js
{
    triggeringToken: Token,
    remainingStress: number,
    cancelStress: Function(reasonText, title, allowConfirm, userIdControl)
}
```

</details>

<details><summary><b><code>onStress</code></b> - after the overheat roll</summary>

```js
{
    triggeringToken: Token,
    remainingStress: number,
    rollResult: number
}
```

</details>

<details><summary><b><code>onRoll</code></b> - between a roll resolving and its chat card printing</summary>

Fires for `attackRoll`, `techAttackRoll`, `damageRoll`, `skillRoll`, `structureRoll`, `stressRoll`.

```js
{
    triggeringToken: Token,
    rollType: string,
    roll: Roll,
    total: number,
    success: boolean,
    targets: Array<Object>,
    item: Item,
    isReroll: boolean,
    rerollCount: number,
    reroll: Function(reason?),
    changeRoll: Function(newTotal),
    flowState: Object
}
```

- `reroll()` re-runs the Lancer flow step that produced the roll; `changeRoll(newTotal)` sets the total (and recomputes hit/crit for attack flows). Both cascade: after either call, `onRoll` re-fires so later reactions see the new state.
- No engine-level reroll cap; reactions that reroll should gate themselves via `flowState.la_extraData._myReactionRerolled`.
- `success` rule: attack/tech = any hit; skill = total >= 10; damage/structure/stress = undefined.
- `changeRoll` on structure/stress only updates `roll._total` (title/desc stay stale, prefer `reroll()`).

</details>

<details><summary><b><code>onDestroyed</code></b> - token delete when <code>structure.value &lt;= 0 || stress.value &lt;= 0</code></summary>

```js
{ triggeringToken: Token }
```

</details>

<details><summary><b><code>onTokenCreated</code></b> - any token placed on the canvas (100ms delay, same timing as onInit)</summary>

```js
{
    triggeringToken: Token,
    distanceToTrigger: number,
    canTriggerReaction: boolean
}
```

</details>

<details><summary><b><code>onTokenRemoved</code></b> - any token deletion (unconditional, unlike onDestroyed)</summary>

`triggeringToken` may be a fallback `{ document, id, name, actor }` object if the canvas token is already gone.

```js
{
    triggeringToken: Token,
    distanceToTrigger: number,
    canTriggerReaction: boolean
}
```

</details>

<details><summary><b><code>onTokenVisibility</code></b> - token <code>hidden</code> flag toggled (GM eye icon)</summary>

```js
{
    triggeringToken: Token,
    isHidden: boolean,
    distanceToTrigger: number,
    canTriggerReaction: boolean
}
```

</details>

#### HP & Heat Triggers

<details><summary><b><code>onPreHpChange</code></b> - before HP changes, can cancel or modify the value</summary>

```js
{
    triggeringToken: Token,
    previousHP: number,
    newHP: number,
    delta: number,
    cancelHpChange: Function(reasonText, title, allowConfirm, userIdControl),
    modifyHpChange: Function(newValue)
}
```

</details>

<details><summary><b><code>onHpGain</code></b> - after HP increases</summary>

```js
{
    triggeringToken: Token,
    hpChange: number,
    currentHP: number,
    maxHP: number
}
```

</details>

<details><summary><b><code>onHpLoss</code></b> - after HP decreases</summary>

```js
{
    triggeringToken: Token,
    hpLost: number,
    currentHP: number
}
```

</details>

<details><summary><b><code>onPreHeatChange</code></b> - before heat changes, can cancel or modify the value</summary>

```js
{
    triggeringToken: Token,
    previousHeat: number,
    newHeat: number,
    delta: number,
    cancelHeatChange: Function(reasonText, title, allowConfirm, userIdControl),
    modifyHeatChange: Function(newValue)
}
```

</details>

<details><summary><b><code>onHeatGain</code></b> - after heat increases</summary>

```js
{
    triggeringToken: Token,
    heatChange: number,
    currentHeat: number,
    inDangerZone: boolean
}
```

</details>

<details><summary><b><code>onHeatLoss</code></b> - after heat decreases</summary>

```js
{
    triggeringToken: Token,
    heatCleared: number,
    currentHeat: number
}
```

</details>

#### Stat & Activation Triggers

<details><summary><b><code>onInitCheck</code></b> - before the check roll</summary>

```js
{
    triggeringToken: Token,
    statName: string,
    checkAgainstToken: Token,
    targetVal: number,
    cancelCheck: Function(reasonText, title, allowConfirm, userIdControl)
}
```

</details>

<details><summary><b><code>onCheck</code></b> - check result</summary>

```js
{
    triggeringToken: Token,
    statName: string,
    roll: Roll,
    total: number,
    success: boolean,
    checkAgainstToken: Token,
    targetVal: number
}
```

</details>

<details><summary><b><code>onInitActivation</code></b> - before item/action activates, before resource use (non-async evaluate only)</summary>

```js
{
    triggeringToken: Token,
    actionType: string,
    actionName: string,
    item: Item,
    actionData: Object,
    deployable: Object,
    cancelAction: Function(reasonText, title, allowConfirm, userIdControl),
    flowState: Object
}
```

</details>

<details><summary><b><code>onActivation</code></b> - item/action fired</summary>

`extraData` carries anything injected via `startRelatedFlowToReactor` / flow-state injection.

```js
{
    triggeringToken: Token,
    actionType: string,
    actionName: string,
    item: Item,
    actionData: Object,
    deployable: Object,
    endActivation: boolean,
    extraData: Object,
    flowState: Object
}
```

</details>

<details><summary><b><code>onUpdate</code></b> - any token document update (high frequency, gate tightly)</summary>

```js
{
    triggeringToken: Token,
    document: TokenDocument,
    change: Object,
    options: Object
}
```

</details>

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

#### `triggerData.debugActivation(label?)`
Console-logs everything the current callback received, including the helper functions that trigger provides. Available in `evaluate` and `activationCode`.
- **Returns**: the same content as a summary `Object`.
- Also on the api: `api.debugActivation(triggerType, triggerData, reactorToken, item, activationName, label?)`.

---

## Concepts

### Consumption

Charge-consumption config attached to an effect. Set it via `extraOptions.consumption` on `applyEffectsToTokens`, or `options.consumption` on `addGlobalBonus`.

`consumeEffectCharge(effect)` decrements the effect's `statuscounter` on each matching trigger and deletes the effect at 0; `processEffectConsumption` matches and spends it on every trigger. `grouped` / `groupId` make several effects share one counter (deleted together).

```javascript
{
    trigger: "onDamage",         // Required: trigger name(s) that consume a charge (string or array)
    originId: "tokenId",         // Only consume if this token is involved (defaults to the bearer token)
    stack: 1,                    // Initial charge count (each matching trigger removes 1)
    grouped: true,               // Share one counter across all effects in this call (auto-fills groupId)
    groupId: "customId",         // Shared counter ID across calls
    evaluate: null,              // (type, data, token, effect) => boolean gate
    itemLid: "weapon_lid",       // filter by item source
    actionName: "Skirmish",      // filter by action name
    isBoost: false,              // consume only on boost tokens
    minDistance: 1,              // distance filter
    checkType: "Agility",        // stat filter
    checkAbove: 10,              // threshold
    checkBelow: 5                // threshold
}
```

### Reaction economy

Two separate keys:
- **`checkReaction`** (reaction config, default `true` via `!== false`) - the availability **gate**. When set, the reaction is skipped if the reactor has no reaction left this round.
- **`consumeReaction`** (world setting, default off) - what **spends** a reaction: when a `Reaction`-type action fires, it decrements `system.action_tracker.reaction` by 1.

### Effect flags

Every effect this module creates stores its metadata under `flags['lancer-automations']`. Any extra keys you pass in `extraOptions` (beyond reserved meta keys like `stack` / `consumption` / `changes`) are copied there as-is: `extraFlags` on `removeEffectsByName*` deletes an effect only if ALL supplied keys equal the stored values.

Two keys the module manages itself:
- **`linkedBonusId`** - ties an effect to a bonus so removing one removes the other.
- **`statDirect`** - stat-reversal metadata `{ key, value, preBonusValue }` used to restore a current-resource stat by its delta when the effect ends.

### extraData / la_extraData

Ad-hoc state that round-trips through a flow. Pass it in (`startRelatedFlowToReactor(userId, extraData)`, or `flowState.injectFlowExtraData(extraData)` mid-flow); it is merged onto `state.la_extraData` and resurfaces as `triggerData.extraData` on the downstream `onActivation`. Read it back inside a flow with `flowState.getFlowExtraData()`.

### Immunity subtypes

Immunity bonuses (`type: "immunity"`) carry exactly one `subtype`. The engine only recognises these values; all resolve through `getImmunityBonuses(actor, subtype)`:

| Subtype | Checked by | Extra fields |
|:--------|:-----------|:-------------|
| `effect` | `checkEffectImmunities` | `effects: [names]` |
| `damage` | `applyDamageImmunities` | `damageTypes: [types]` |
| `resistance` | `checkDamageResistances` (halves) | `damageTypes: [types]` |
| `crit` | `hasCritImmunity` | - |
| `hit` | `hasHitImmunity` | - |
| `miss` | `hasMissImmunity` | - |
| `elevation` | `isClimbingImmune` (movement) | - |
| `terrain` | `isTerrainImmune` (terrain / zones) | - |
| `provoke` | engagement + reaction gate | - |

### Duration labels

Accepted `duration.label` values:
- `start` / `end` / `round` - tick down at turn start, turn end, or round change. Only these expire by time, and only in combat.
- `indefinite` / `permanent` - never expire by time.
- `constant` - bonus only: passive and invisible, no token icon or counter (same as `addConstantBonus`).

### Stat codes

HASE-plus-grit keys used by stat rolls and checks: `HULL`, `AGI`, `SYS`, `ENG`, `GRIT`.

---

### Activation Object Structure

```javascript
{
    triggers: ["onMove"],        // Array of trigger names
    enabled: true,               // Master toggle
    awaitActivationCompletion: false,     // Wait for resolution (required for onPreMove, onInitActivation, onInitAttack, onInitTechAttack, onInitCheck intercepts)
    triggerDescription: "",      // Header text for the reaction card
    effectDescription: "",       // Body text for the reaction card
    actionType: "Reaction",      // Reaction, Free Action, Quick, Full, Protocol, Other
    frequency: "1/Round",        // Display-only frequency text
    triggerSelf: false,          // Can react to own actions
    triggerOther: true,          // Can react to others
    checkReaction: true,         // Skip if the reactor has no reaction left this round (default true)
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
