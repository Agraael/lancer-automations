# Lancer Automations — API Reference

## Documentation Files

| File | Contents |
|------|----------|
| **[API_COMBAT.md](API_COMBAT.md)** | Combat flows, spatial/distance tools, weapon/item details, resource management |
| **[API_EFFECTS.md](API_EFFECTS.md)** | Status effect management, global/constant bonuses, immunities, flow state injection |
| **[API_INTERACTIVE.md](API_INTERACTIVE.md)** | Token picker, zones, knockback, movement, choice cards, deployment, thrown weapons, movement tracking |
| **[API_HOWTO.md](API_HOWTO.md)** | Registration, user helpers, how-tos, Grid-Aware Auras wrapper |

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

<details><summary><b>Attack Triggers</b></summary>

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

</details>

<details><summary><b>Tech Triggers</b></summary>

- **`onInitTechAttack`**: Before Tech HUD. `{ triggeringToken, techItem, targets, actionName, isInvade, tags, actionData, cancelTechAttack(reasonText, title, showCard, userIdControl) }`
- **`onTechAttack`**: Tech roll made. `{ triggeringToken, techItem, targets, actionName, isInvade, tags, actionData }`
- **`onTechHit`**: `{ triggeringToken, techItem, targets: Array<{target, roll, crit}>, ... }`
- **`onTechMiss`**: `{ triggeringToken, techItem, targets: Array<{target, roll}>, ... }`

</details>

<details><summary><b>Movement Triggers</b></summary>

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

</details>

<details><summary><b>Deployment & Placement Triggers</b></summary>

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

</details>

<details><summary><b>Turn Events</b></summary>

- **`onTurnStart`** / **`onTurnEnd`**: `{ triggeringToken }`.
- **`onEnterCombat`** / **`onExitCombat`**: `{ triggeringToken }`. Fires when a token is added to or removed from the combat tracker.

</details>

<details><summary><b>Status Effect Triggers</b></summary>

- **`onPreStatusApplied`**: Before a status is applied. `{ triggeringToken, statusId, effect, cancelChange(reasonText, title, showCard, userIdControl) }`. Non-async evaluate only.
- **`onPreStatusRemoved`**: Before a status is removed. `{ triggeringToken, statusId, effect, cancelChange(reasonText, title, showCard, userIdControl) }`. Non-async evaluate only.
- **`onStatusApplied`** / **`onStatusRemoved`**: `{ triggeringToken, statusId, effect }`.

</details>

<details><summary><b>Structure & Stress Triggers</b></summary>

- **`onPreStructure`**: Before the structure roll. `{ triggeringToken, remainingStructure, cancelStructure(reasonText, title, showCard, userIdControl) }`. Can cancel the entire structure flow.
- **`onStructure`**: After the structure roll. `{ triggeringToken, remainingStructure, rollResult }`.
- **`onPreStress`**: Before the overheat roll. `{ triggeringToken, remainingStress, cancelStress(reasonText, title, showCard, userIdControl) }`. Can cancel the entire overheat flow.
- **`onStress`**: After the overheat roll. `{ triggeringToken, remainingStress, rollResult }`.
- **`onDestroyed`**: `{ triggeringToken }`.

</details>

<details><summary><b>HP & Heat Triggers</b></summary>

- **`onPreHpChange`**: Before HP changes. `{ triggeringToken, previousHP, newHP, delta, cancelHpChange(reasonText, title, showCard, userIdControl), modifyHpChange(newValue) }`. Can cancel or modify the HP value.
- **`onHpGain`**: After HP increases. `{ triggeringToken, hpChange, currentHP, maxHP }`.
- **`onHpLoss`**: After HP decreases. `{ triggeringToken, hpLost, currentHP }`.
- **`onPreHeatChange`**: Before heat changes. `{ triggeringToken, previousHeat, newHeat, delta, cancelHeatChange(reasonText, title, showCard, userIdControl), modifyHeatChange(newValue) }`. Can cancel or modify the heat value.
- **`onHeatGain`**: After heat increases. `{ triggeringToken, heatChange, currentHeat, inDangerZone }`.
- **`onHeatLoss`**: After heat decreases. `{ triggeringToken, heatCleared, currentHeat }`.

</details>

<details><summary><b>Stat & Activation Triggers</b></summary>

- **`onInitCheck`**: Before roll. `{ triggeringToken, statName, checkAgainstToken, targetVal, cancelCheck(reasonText, title, showCard, userIdControl) }`.
- **`onCheck`**: Result. `{ triggeringToken, statName, roll, total, success, checkAgainstToken, targetVal }`.
- **`onInitActivation`**: Before item/action activates (before resource use). `{ triggeringToken, actionType, actionName, item, actionData, cancelAction(reasonText, title, showCard, userIdControl) }`. Non-async evaluate only.
- **`onActivation`**: Item/Action fired. `{ triggeringToken, actionType, actionName, item, actionData, endActivation }`.
- **`onUpdate`**: **WARNING**: Generic document update (High frequency).

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
    originId: "tokenId",         // Only consume if this token is involved
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
