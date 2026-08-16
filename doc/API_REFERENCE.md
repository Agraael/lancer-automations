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
| **[API_HUD.md](API_HUD.md)** | Extra actions, action locks, and combat overlays in the Token Action HUD |
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

### Shared Types

Source: [`scripts/typing/types.d.ts`](../scripts/typing/types.d.ts).

<details>
<summary><b><code>CancelFunction</code></b> → <code>Promise&lt;void&gt;</code></summary>

<br>

```ts
(reasonText?, title?, allowConfirm?, userIdControl?, preConfirm?, postChoice?, opts?) => Promise<void>
.wait(): Promise<void>
```

Used by `cancelAttack`, `cancelTechAttack`, `cancelCheck`, `cancelAction`, `cancelChange`, `cancelStructure`, `cancelStress`, `cancelStructureOutcome`, `cancelStressOutcome`. Aborts synchronously, so call it before any `await` in your `activationCode`.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>reasonText</kbd> | `string` | per-trigger | Card description |
| <kbd>title</kbd> | `string` | per-trigger | Card header |
| <kbd>allowConfirm</kbd> | `boolean` | `true` | `false` cancels with no card |
| <kbd>userIdControl</kbd> | `string \| string[] \| null` | `null` | Who sees the card. `null` = active GM |
| <kbd>preConfirm</kbd> | `(() => Promise<boolean>) \| null` | `null` | Asked first. `true` cancels, `false` takes the ignore path |
| <kbd>postChoice</kbd> | `((chose: boolean) => Promise<void>) \| null` | `null` | `chose` is `true` if it stayed cancelled |
| <kbd>opts</kbd> | `{ item?, originToken?, relatedToken? }` | `{}` | Documents shown on the card |

The ignore path re-runs the original action. Reactors already in `_cancelledBy` are skipped on the redo, so a gate is not asked twice. `.wait()` resolves after the card and any redo.

</details>

<details>
<summary><b><code>CancelMoveFunction</code></b> · <b><code>ChangeMoveFunction</code></b> → <code>Promise&lt;void&gt;</code></summary>

<br>

```ts
cancelTriggeredMove(reasonText?, allowConfirm?, userIdControl?, preConfirm?, postChoice?, opts?)
changeTriggeredMove(position: {x: number, y: number}, extraData?, reasonText?, allowConfirm?, userIdControl?, preConfirm?, postChoice?, opts?)
```

`CancelFunction` params minus `title`. A rerouted move is a new move, so reactors may evaluate it again.

</details>

<details>
<summary><b><code>ModifyValueFunction</code></b> · <b><code>RerollFunction</code></b> · <b><code>ChangeRollFunction</code></b> → <code>Promise&lt;void&gt;</code></summary>

<br>

```ts
modifyHpChange(newValue: number, reasonText?, allowConfirm?, userIdControl?, preConfirm?, postChoice?, opts?)
modifyHeatChange(newValue: number, ...same)          // .wait() on both
modifyRoll(newTotal: number) => void                 // structure/stress, no card
reroll(reasonText?, subtype?, title?, allowConfirm?, userIdControl?, opts?)
changeRoll(newTotal: number, reasonText?, title?, allowConfirm?, userIdControl?, preConfirm?, postChoice?, opts?)
```

`subtype` defaults to `'retry'`. Trailing params behave as on `CancelFunction`.

</details>

<details>
<summary><b><code>ActivationCallback</code></b> - shape of <code>evaluate</code> and <code>activationCode</code></summary>

<br>

```ts
(triggerType: TriggerType, triggerData: TriggerData, reactorToken: Token,
 item: Item | null, activationName: string, api: LancerAutomationsAPI) => any
```

`item` is `null` for general activations.

</details>

<details>
<summary><b><code>actionData</code></b> · <b><code>flowState</code></b> - the recurring payload objects</summary>

<br>

| `actionData` field | Type |
|:------|:-----|
| <kbd>type</kbd> | `string` (`"action"` / `"attack"` / `"tech"`) |
| <kbd>title</kbd> | `string` |
| <kbd>action</kbd> | `{ name: string, activation: string } \| null` |
| <kbd>detail</kbd> | `string` |
| <kbd>tags</kbd> | `Array<{ lid: string, val?: string }>` |
| <kbd>flowState</kbd> | `FlowState` |

`flowState` is the Lancer flow `state`: `state.data` (e.g. `data.damage`, `data.bonus_damage`), `state.la_extraData`, `state.injectFlowExtraData(obj)`, `state.getFlowExtraData()`, `state.actor`, `state.item`.

</details>

<br>

### Trigger Types & Data

Every trigger passes a data object. All objects receive `distanceToTrigger` and `canTriggerReaction` (reactor to triggering token), plus `_cancelledBy` on cancellable triggers.

`Tag` is `{ lid: string, val?: string }`. `ActionData` and `FlowState` are defined above.

#### Attack Triggers

<details><summary><b><code>onInitAttack</code></b> - attack initiated, before Attack HUD</summary>

```js
{
    triggeringToken: Token,
    weapon: Item,
    targets: Array<Token>,
    actionName: string,
    tags: Array<Tag>,
    actionData: ActionData,
    cancelAttack: CancelFunction
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
    tags: Array<Tag>,
    actionData: ActionData
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
    tags: Array<Tag>,
    actionData: ActionData
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
    tags: Array<Tag>,
    actionData: ActionData
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
    hitTokens: Array<Token>,
    attackType: string,
    actionName: string,
    tags: Array<Tag>,
    actionData: ActionData,
    cancelDamage: CancelFunction,
    flowState: FlowState
}
```

`cancelDamage` aborts the whole damage roll, so no damage card is printed. It is flow-wide, not per target: to spare one target of several, set that entry's `hit` to `false` in `flowState.data.hit_results` instead.

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
    tags: Array<Tag>,
    actionData: ActionData
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
    tags: Array<Tag>,
    actionData: ActionData,
    cancelTechAttack: CancelFunction
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
    tags: Array<Tag>,
    actionData: ActionData
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
    tags: Array<Tag>,
    actionData: ActionData
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
    tags: Array<Tag>,
    actionData: ActionData
}
```

</details>

#### Movement Triggers

<details><summary><b><code>onPreMove</code></b> - before movement is finalized</summary>

```js
{
    triggeringToken: Token,
    distanceToMove: number,
    elevationToMove: number,
    startPos: { x, y },
    endPos: { x, y },
    isDrag: boolean,
    moveInfo: {
        isInvoluntary: boolean,
        isTeleport: boolean,
        isUndo: boolean,
        isModified: boolean,
        pathHexes: Array<{ x, y, cx, cy, isHistory, hexes }>
    },
    cancel: () => void,
    cancelTriggeredMove: CancelMoveFunction,
    changeTriggeredMove: ChangeMoveFunction
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
        extraData: Record<string, any>
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
    cancel: (reason?: string) => void
}
```

- `cancel(reason?)` synchronously skips this specific token's move. Other tokens in the batch still proceed.
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
    cancelChange: CancelFunction
}
```

</details>

<details><summary><b><code>onPreStatusRemoved</code></b> - before a status is removed (non-async evaluate only)</summary>

```js
{
    triggeringToken: Token,
    statusId: string,
    effect: ActiveEffect,
    cancelChange: CancelFunction
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
    cancelStructure: CancelFunction,
    flowState: FlowState
}
```

</details>

<details><summary><b><code>onStructure</code></b> - after the structure roll</summary>

```js
{
    triggeringToken: Token,
    remainingStructure: number,
    rollResult: number,
    rollDice: number[],
    cancelStructureOutcome: CancelFunction,
    modifyRoll: (newTotal: number) => void,
    flowState: FlowState
}
```

</details>

<details><summary><b><code>onPreStress</code></b> - before the overheat roll, can cancel the flow</summary>

```js
{
    triggeringToken: Token,
    remainingStress: number,
    cancelStress: CancelFunction,
    flowState: FlowState
}
```

</details>

<details><summary><b><code>onStress</code></b> - after the overheat roll</summary>

```js
{
    triggeringToken: Token,
    remainingStress: number,
    rollResult: number,
    rollDice: number[],
    cancelStressOutcome: CancelFunction,
    modifyRoll: (newTotal: number) => void,
    flowState: FlowState
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
    reroll: RerollFunction,
    changeRoll: ChangeRollFunction,
    flowState: FlowState
}
```

- `reroll()` re-runs the Lancer flow step that produced the roll. `changeRoll(newTotal)` sets the total (and recomputes hit/crit for attack flows). Both cascade: after either call, `onRoll` re-fires so later reactions see the new state.
- No engine-level reroll cap. Reactions that reroll should gate themselves via `api.setFlowFlag(triggerData, '_myReactionRerolled')` + `api.getFlowFlag` in `evaluate`.
- `success` rule: attack/tech = any hit, skill = total >= 10, damage/structure/stress = undefined.
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
    cancelHpChange: CancelFunction,
    modifyHpChange: ModifyValueFunction
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
    cancelHeatChange: CancelFunction,
    modifyHeatChange: ModifyValueFunction
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
    cancelCheck: CancelFunction
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
    actionData: ActionData,
    deployable: { actor: Actor, lid: string } | null,
    cancelAction: CancelFunction,
    flowState: FlowState
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
    actionData: ActionData,
    deployable: { actor: Actor, lid: string } | null,
    endActivation: boolean,
    extraData: Record<string, any>,
    flowState: FlowState
}
```

</details>

<details><summary><b><code>onUpdate</code></b> - any token document update (high frequency, gate tightly)</summary>

```js
{
    triggeringToken: Token,
    document: TokenDocument,
    change: Record<string, any>,
    options: Record<string, any>
}
```

</details>

---

### Callback Signatures

Shared params: `triggerType: TriggerType`, `triggerData: TriggerData`, `reactorToken: Token`, `item: Item | null` (null for general activations), `activationName: string`, `api: LancerAutomationsAPI`.

| Callback | Signature | Returns |
|:---------|:----------|:--------|
| `evaluate` | `(triggerType, triggerData, reactorToken, item, activationName, api)` | `boolean` - must be **synchronous** on cancellable triggers |
| `activationCode` | `(triggerType, triggerData, reactorToken, item, activationName, api)` | `Promise<void>` |
| `onInit` | `(token: Token, item: Item, api: LancerAutomationsAPI)` | `Promise<void>` - runs when a token carrying the item is created |
| `onMessage` | `(triggerType, data: any, reactorToken, item, activationName, api)` | `Promise<void>` - runs on the client targeted by `sendMessageToReactor` |

#### `triggerData.debugActivation(label?: string)`
Console-logs everything the current callback received, including the helper functions the trigger provides. Available in `evaluate` and `activationCode`.
- **Returns**: `Object` - the same content as a summary.
- API form: `api.debugActivation(triggerType, triggerData, reactorToken, item, activationName, label?: string)` → `Object`.

---

## Concepts

### Consumption

Charge-consumption config attached to an effect. Set it via `extraOptions.consumption` on `applyEffectsToTokens`, or `options.consumption` on `addGlobalBonus`.

`consumeEffectCharge(effect)` decrements the effect's `statuscounter` on each matching trigger and deletes the effect at 0. `processEffectConsumption` matches and spends it on every trigger. `grouped` / `groupId` make several effects share one counter (deleted together).

| Field | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>trigger</kbd> | `TriggerType \| TriggerType[]` | *required* | Trigger(s) that consume a charge |
| <kbd>originId</kbd> | `string` | bearer token id | Only consume if this token is involved |
| <kbd>role</kbd> | `"source" \| "target"` | either | How the origin must be involved: caused the trigger, or was one of its targets |
| <kbd>stack</kbd> | `number` | `1` | Initial charge count. Each matching trigger removes 1 |
| <kbd>grouped</kbd> | `boolean` | `false` | Share one counter across all effects in this call (auto-fills `groupId`) |
| <kbd>groupId</kbd> | `string` | auto | Shared counter id across calls |
| <kbd>evaluate</kbd> | `(triggerType: TriggerType, data: TriggerData, token: Token, effect: ActiveEffect) => boolean` | `null` | Extra gate |
| <kbd>itemLid</kbd> | `string` | - | Only consume for this item source |
| <kbd>actionName</kbd> | `string` | - | Only consume for this action name |
| <kbd>isBoost</kbd> | `boolean` | `false` | Consume only on boost movement |
| <kbd>minDistance</kbd> | `number` | - | Distance filter |
| <kbd>checkType</kbd> | `string` | - | Stat filter, e.g. `"Agility"` |
| <kbd>checkAbove</kbd> | `number` | - | Only consume if the roll is above this |
| <kbd>checkBelow</kbd> | `number` | - | Only consume if the roll is below this |

**Resistance that lasts 3 hits** (Dispersal Shield). One counter shared by all five resistance effects, so they vanish together on the third hit:

```js
await api.applyEffectsToTokens({
    tokens: [target],
    effectNames: ["resistance_kinetic", "resistance_energy", "resistance_explosive"],
    note: "Dispersal Shield"
}, {
    stack: 3,
    consumption: { trigger: "onDamage", originId: target.id, grouped: true }
});
```

**+1 accuracy on the next attack only**, spent when it hits:

```js
await api.addGlobalBonus(target.actor, { name: "Squad Leader", val: 1, type: "accuracy", rollTypes: ["attack"] },
    { duration: "1 Round", origin: reactorToken, consumption: { trigger: "onHit" } });
```

**Only spend on a failed Agility save**, using the gate:

```js
consumption: {
    trigger: "onCheck",
    checkType: "Agility",
    evaluate: (triggerType, data, token, effect) => data.success === false
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

Ad-hoc state that round-trips through a flow. Pass it in (`startRelatedFlowToReactor(userId, extraData)`, or `flowState.injectFlowExtraData(extraData)` mid-flow). It is merged onto `state.la_extraData` and resurfaces as `triggerData.extraData` on the downstream `onActivation`. Read it back inside a flow with `flowState.getFlowExtraData()`.

### Immunity subtypes

Immunity bonuses (`type: "immunity"`) carry exactly one `subtype`. The engine only recognises these values. All resolve through `getImmunityBonuses(actor, subtype)`:

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
| `obstacle` | `isPhasing` (move through other characters) | - |
| `provoke` | engagement + reaction gate | - |

### Duration labels

Accepted `duration.label` values:
- `start` / `end` / `round` - tick down at turn start, turn end, or round change. Only these expire by time, and only in combat.
- `indefinite` - never expires by time. `unlimited` is a retired alias, still accepted and normalized to `indefinite`.
- `permanent` - never expires by time and [survives a Full Repair](feature/SYSTEM_ADDITIONS.md#permanent-statuses).
- `constant` - bonus only: passive and invisible, no token icon or counter (same as `addConstantBonus`).

### Stat codes

HASE-plus-grit keys used by stat rolls and checks: `HULL`, `AGI`, `SYS`, `ENG`, `GRIT`.

---

### Activation Object Structure

One entry in an activation group's `reactions` array. Interface: `ReactionConfig` in [`types.d.ts`](../scripts/typing/types.d.ts).

| Field | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>triggers</kbd> | `TriggerType[]` | *required* | Trigger names this entry listens to |
| <kbd>enabled</kbd> | `boolean` | `true` | Master toggle |
| <kbd>awaitActivationCompletion</kbd> | `boolean` | `false` | Required to intercept `onPreMove`, `onInitActivation`, `onInitAttack`, `onInitTechAttack`, `onInitCheck` |
| <kbd>triggerDescription</kbd> | `string` | `""` | Header text on the activation card |
| <kbd>effectDescription</kbd> | `string` | `""` | Body text on the activation card |
| <kbd>actionType</kbd> | `"Automation" \| "Reaction" \| "Free Action" \| "Quick Action" \| "Full Action" \| "Protocol" \| "Other"` | `"Automation"` | Lancer action type. `"Reaction"` is what spends a reaction |
| <kbd>frequency</kbd> | `string` | `""` | Display-only text |
| <kbd>triggerSelf</kbd> | `boolean` | `false` | React to own actions |
| <kbd>triggerOther</kbd> | `boolean` | `true` | React to others' actions (includes targets) |
| <kbd>triggerTarget</kbd> | `boolean` | `false` | React when the reactor is one of the event's targets, even with `triggerOther` off. Target-capable triggers only |
| <kbd>checkReaction</kbd> | `boolean` | `true` | Skip if the reactor has no Reaction left this round |
| <kbd>outOfCombat</kbd> | `boolean` | `false` | Also fire outside combat |
| <kbd>onlyOnSourceMatch</kbd> | `boolean` | `false` | Match by name (general) or by possession (item) |
| <kbd>dispositionFilter</kbd> | `Array<"hostile" \| "friendly" \| "neutral" \| "secret">` | `[]` | Restrict by disposition toward the trigger |
| <kbd>reactionPath</kbd> | `string` | `""` | Action path, e.g. `extraActions.Print` |
| <kbd>evaluate</kbd> | `ActivationCallback \| string` | - | Gate. Must be synchronous on cancellable triggers |
| <kbd>activationType</kbd> | `"code" \| "macro" \| "flow" \| "none"` | `"flow"` | What runs |
| <kbd>activationMode</kbd> | `"instead" \| "after"` | item: `"instead"`, general: `"after"` | `after` also fires the reaction's own flow/card; macro/code only |
| <kbd>activationCode</kbd> | `ActivationCallback \| string` | - | The body, for `activationType: "code"` |
| <kbd>activationMacro</kbd> | `string` | `""` | Macro name, for `activationType: "macro"` |
| <kbd>autoActivate</kbd> | `boolean` | `false` | Skip the popup and run immediately |
| <kbd>onInit</kbd> | `((token, item, api) => Promise<void>) \| string` | - | Runs on token creation |
| <kbd>onMessage</kbd> | `((triggerType, data, reactorToken, item, activationName, api) => Promise<void>) \| string` | - | Runs on the client targeted by `sendMessageToReactor` |

The group wrapper (`ReactionGroup`) is `{ category?: string, itemType?: string, enabled?: boolean, reactions: ReactionConfig[] }`.

A whole group, as registered by an item LID:

```js
api.registerDefaultItemReactions({
    "npcf_suppress_archer": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,     // only when THIS feature is used
            triggerSelf: true,
            autoActivate: true,          // no popup
            outOfCombat: true,
            actionType: "Quick Action",
            activationType: "code",
            activationMode: "instead",   // replace the item's own flow
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const targets = await api.chooseToken(reactorToken, { range: 10, count: 1 });
                if (targets?.length)
                    await api.applyMark(reactorToken, targets, { effect: "impaired" });
            }
        }]
    }
});
```

A setup-only entry (no trigger, runs once per token) uses `triggers: []` with `activationType: "none"` and an `onInit`.
