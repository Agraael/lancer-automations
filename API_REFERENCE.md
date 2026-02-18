# Lancer Automations — API Reference

## Accessing the API

```javascript
const api = game.modules.get('lancer-automations').api;
```

Also available via hook (fires once the module is ready):

```javascript
Hooks.on('lancer-automations.ready', (api) => {
    // api is the same object as above
});
```

---

## Exposed Functions

### Effect Management

#### `applyFlaggedEffectToTokens(options, extraOptions)`

Apply status effects to tokens. Supports stacking, duration, consumption, and stat bonuses/changes.

**Parameters:**

`options` object:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `tokens` | `Array<Token>` | *required* | Tokens to apply the effect to |
| `effectNames` | `string \| Array<string> \| Object` | *required* | Effect name(s) or custom effect object `{ name, icon, isCustom, stack }` |
| `note` | `string` | `undefined` | Description/note stored on the effect |
| `duration` | `Object` | `undefined` | `{ label: "start"\|"end"\|"indefinite", turns: number, rounds: number }` |
| `useTokenAsOrigin` | `boolean` | `true` | Use the target token's ID as origin for duration tracking |
| `customOriginId` | `string` | `null` | Override origin ID (ignored if `useTokenAsOrigin` is true) |
| `checkEffectCallback` | `Function` | `null` | Custom predicate `(token, effect) => boolean` to check duplicates |
| `notify` | `Object\|boolean` | `true by default` | Unified notification: `{ source: Item\|string, prefixText: string }`. `prefixText` (default: "Gained") |

`extraOptions` object:

| Property | Type | Description |
|----------|------|-------------|
| `stack` | `number` | Stack count (for statuscounter) |
| `linkedBonusId` | `string` | Link this effect to a global bonus ID |
| `consumption` | `Object` | Consumption trigger config (see [Consumption Object](#consumption-object)) |
| `statDirect` | `Object` | Direct stat modification `{ key, value, preBonusValue }` for current resources |
| `changes` | `Array` | ActiveEffect changes `[{ key, value, mode }]` for max/flat stats |

**Returns:** `Array<Token>` — tokens that received the effect(s).

---

#### `removeFlaggedEffectToTokens(options)`

Remove effects from tokens.

| Property | Type | Description |
|----------|------|-------------|
| `options.tokens` | `Array<Token>` | Tokens to remove from |
| `options.effectNames` | `string \| Array<string>` | Effect name(s) to remove |
| `options.originId` | `string` | Optional origin ID to filter which effects to remove |
| `options.notify` | `Object\|boolean` | `true by default` Unified notification: `{ source: Item\|string, prefixText: string }`. `prefixText` (default: "Loss") |

**Returns:** `Array<Token>` — processed tokens.

---

#### `findFlaggedEffectOnToken(token, identifier)`

Find a flagged effect on a token.

| Parameter | Type | Description |
|-----------|------|-------------|
| `token` | `Token` | The token to search |
| `identifier` | `string \| Function` | Effect name, or a predicate `(effect) => boolean` |

**Returns:** `ActiveEffect | undefined`

---

#### `consumeEffectCharge(effect)`

Decrement one charge from a consumable effect. If it reaches 0, the effect is removed. If the effect has a `groupId`, all effects in the group share the same counter.

| Parameter | Type | Description |
|-----------|------|-------------|
| `effect` | `ActiveEffect` | The effect to consume a charge from |

**Returns:** `Promise<boolean>`

---

#### `executeEffectManager(options)`

Open the Effect Manager dialog UI.

---

### Global Bonuses

#### `addGlobalBonus(actor, bonusData, options)`

Add a global bonus to an actor. Creates a linked status effect on the token.

**`bonusData` object:**

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Auto-generated if not provided |
| `name` | `string` | Bonus display name |
| `val` | `number` | Bonus value |
| `type` | `string` | `"accuracy"`, `"difficulty"`, `"damage"`, or `"stat"` |
| `uses` | `number` | Stack count (optional) |
| `stat` | `string` | For stat bonuses: property path (e.g. `"system.hp.max"`, `"system.evasion"`) |
| `targetTypes` | `Array<string>` | Flow type filters: `["all"]`, `["attack"]`, `["check"]`, `["damage"]`, etc. |
| `condition` | `string \| function` | JS condition — function reference or string expression. Args: `(state, actor, data, context)`, returns boolean. Supports async. |
| `itemLids` | `Array<string>` | Item LID filters |
| `context` | `Object` | Data passed to condition evaluation |
| `damage` | `Array<Object>` | For damage bonuses: `[{ type: "Kinetic", val: 2 }]` |

**`options` object:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `duration` | `string` | `undefined` | `"indefinite"`, `"end"`, or `"start"` |
| `durationTurns` | `number` | `1` | Turns until expiration (if not indefinite) |
| `origin` | `Token \| string` | token | Origin token or ID for duration tracking |
| `consumption` | `Object` | `undefined` | Consumption trigger config (see [Consumption Object](#consumption-object)) |

**Returns:** `string` — the bonus ID.

---

#### `removeGlobalBonus(actor, bonusId, skipEffectRemoval)`

Remove a global bonus and its linked effect.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `actor` | `Actor` | | The actor to remove from |
| `bonusId` | `string` | | The bonus ID to remove |
| `skipEffectRemoval` | `boolean` | `false` | Skip removing the linked ActiveEffect |

**Returns:** `Promise<boolean>`

---

#### `getGlobalBonuses(actor)`

Get all global bonuses for an actor.

**Returns:** `Array<Object>` — array of bonus data objects.

---

#### `injectBonusToNextRoll(actor, bonus)`

Inject a one-time bonus (ephemeral) into the next applicable roll the actor makes. The bonus is automatically consumed upon opening the roll dialog.

| Parameter | Type | Description |
|-----------|------|-------------|
| `actor` | `Actor` | The actor to inject the bonus into |
| `bonus` | `Object` | The bonus object (see `addGlobalBonus` for structure) |

**Returns:** `Promise<void>`

---

### Activation Registration

#### `registerDefaultItemReactions(reactions)`

Register item-based activations by code. Merged with built-in and user-configured activations.

```javascript
api.registerDefaultItemReactions({
    "item_lid_here": {
        itemType: "mech_weapon",  // or "any", "npc_feature", "mech_system", etc.
        reactions: [{ /* activation object */ }]
    }
});
```

---

#### `registerDefaultGeneralReactions(reactions)`

Register general (name-based) activations by code.

```javascript
api.registerDefaultGeneralReactions({
    "My Custom Reaction": { /* activation object */ }
});
```

---

### Spatial / Distance

#### `getActorMaxThreat(actor)`

Get the highest Threat range value across all of an actor's weapons.

**Returns:** `number` (minimum 1 for mechs/NPCs/pilots, 0 for other types)

---

#### `getTokenDistance(token1, token2)`

Get the grid distance between two tokens (in spaces). Handles multi-cell tokens on both square and hex grids.

**Returns:** `number`

---

#### `isHostile(token1, token2)`

Check if two tokens are hostile to each other. Uses Token Factions if available, otherwise falls back to default disposition logic.

**Returns:** `boolean`

---

#### `isFriendly(token1, token2)`

Check if two tokens are friendly to each other.

**Returns:** `boolean`

---

### Utilities

#### `executeStatRoll(actor, stat, title, target, extraData)`

Perform a stat roll. NPCs use Tier for Grit.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `actor` | `Actor` | *required* | The actor making the roll |
| `stat` | `string` | *required* | `"HULL"`, `"AGI"`, `"SYS"`, `"ENG"`, `"GRIT"` (or a full path) |
| `title` | `string` | auto | Roll title |
| `target` | `number` | `10` | Pass threshold |
| `extraData` | `Object` | `{}` | Extra data to inject into flow state |

**Returns:** `{ completed, total, roll, passed }`

```javascript
const result = await api.executeStatRoll(actor, "AGI", "AGILITY Save");
if (result.completed && !result.passed) {
    // failed
}
```

---

#### `executeDamageRoll(attacker, targets, damageValue, damageType, title, options, extraData)`

Perform a damage roll.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `attacker` | `Token\|Actor` | *required* | The attacker |
| `targets` | `Array<Token>` | *required* | The targets |
| `damageValue` | `number` | *required* | Damage amount |
| `damageType` | `string` | *required* | "kinetic", "energy", "explosive", "burn", "heat", "variable" |
| `title` | `string` | "Damage Roll" | Roll title |
| `options` | `Object` | `{}` | Options object (see below) |
| `extraData` | `Object` | `{}` | Extra data to inject into flow state |

**Options Object Properties:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `ap` | `boolean` | `false` | Armor Piercing |
| `paracausal` | `boolean` | `false` | Paracausal Damage |
| `overkill` | `boolean` | `false` | Overkill |
| `reliable` | `boolean` | `false` | Reliable |
| `half_damage` | `boolean` | `false` | Half Damage |
| `add_burn` | `boolean` | `true` | Add Burn (if type is Burn) |
| `invade` | `boolean` | `false` | Is Invasion |
| `has_normal_hit` | `boolean` | `true` | Has normal hit result |
| `has_crit_hit` | `boolean` | `false` | Has critical hit result |
| `tags` | `Array` | `[]` | Damage tags |
| `bonus_damage` | `Array` | `[]` | Bonus damage array |
| `hit_results` | `Array` | `[]` | Pre-calculated hit results (for UI display) |

**Returns:** `{ completed, flow }`

```javascript
await api.executeDamageRoll(attacker, targets, 5, "kinetic", "Test Roll", { ap: true });
```

---

#### `clearMoveData(tokenDocId)`

Reset cumulative movement data for a token. Automatically called at the start of each turn.

---

#### `getCumulativeMoveData(tokenDocId)`

Get the current cumulative movement distance for a token this turn.

**Returns:** `number` (0 if no data)

---

#### `getTokenCells(token)`

Get all grid cells occupied by a token.

**Returns:** `Array<[number, number]>` — array of `[gridX, gridY]` coordinates.

---

#### `getMaxGroundHeightUnderToken(token, terrainAPI)`

Get the maximum ground height under a token, considering all occupied cells. Requires Terrain Height Tools.

| Parameter | Type | Description |
|-----------|------|-------------|
| `token` | `Token` | The token to check |
| `terrainAPI` | `Object` | `globalThis.terrainHeightTools` |

**Returns:** `number`

---

#### `openItemBrowser(targetInput)`

Open a searchable item browser dialog. Searches all compendium packs for items with LIDs.

---

#### `drawThreatDebug(token)`

Debug visualization: draw threat range cells around a token (hex grids only).

---

#### `drawDistanceDebug()`

Debug visualization: select 2 tokens and run this to display the grid distance between them.

---

### Interactive Tools

#### `chooseToken(casterToken, options)`

Interactive token picker. Range highlights, disposition filters, and multi-select support. Prompts user to click tokens on the canvas.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `casterToken` | `Token` | | The origin token (range is measured from here) |
| `options.range` | `number` | `null` | Max range in grid units (`null` = unlimited) |
| `options.includeHidden` | `boolean` | `false` | Include hidden tokens |
| `options.includeSelf` | `boolean` | `false` | If true, the caster token (source) is selectable. |
| `options.filter` | `Function` | `null` | Filter: `(token) => boolean` |
| `options.count` | `number` | `1` | Number of targets to select. `-1` for unlimited (right-click to finish) |
| `options.title` | `string` | `"SELECT TARGETS"` | Info card header text |
| `options.description` | `string` | `""` | Info card description text |
| `options.icon` | `string` | `"fas fa-crosshairs"` | Info card header icon (FontAwesome class) |
| `options.headerClass` | `string` | `""` | Extra CSS class for the info card header |

**Returns:** `Promise<Array<Token>|null>` — selected tokens or `null` if cancelled (ESC / right-click with none selected)

```javascript
const targets = await api.chooseToken(myToken, {
    count: 1,
    range: 10,
    filter: (t) => api.isFriendly(myToken, t),
    title: "CHOOSE ALLY",
    description: "Select a friendly target within range"
});
```

---

#### `placeZone(casterToken, options)`

Interactive zone placement. Shows range highlights and places Lancer templates (Blast, Burst, Cone, Line) with preview.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `casterToken` | `Token` | | The origin token (range is measured from here) |
| `options.range` | `number` | `null` | Max range in grid units (`null` = unlimited) |
| `options.size` | `number` | `1` | Zone radius (Blast size) |
| `options.type` | `string` | `"Blast"` | Template type: `"Blast"`, `"Burst"`, `"Cone"`, `"Line"` |
| `options.fillColor` | `string` | `"#ff6400"` | Fill color |
| `options.borderColor` | `string` | `"#964611ff"` | Border color |
| `options.texture` | `string` | `null` | Texture file path |
| `options.count` | `number` | `1` | Number of zones to place. `-1` for unlimited |
| `options.hooks` | `Object` | `{}` | Hook callbacks passed to `templatemacro`'s placeZone |
| `options.title` | `string` | `"PLACE ZONE"` | Info card header text |
| `options.description` | `string` | `""` | Info card description text |
| `options.icon` | `string` | `"fas fa-bullseye"` | Info card header icon (FontAwesome class) |
| `options.headerClass` | `string` | `""` | Extra CSS class for the info card header |

**Returns:** `Promise<Array<{x, y, template}>|null>` — placed zone positions and template documents

```javascript
const zones = await api.placeZone(myToken, {
    range: 5,
    size: 2,
    type: "Blast",
    fillColor: "#808080",
    title: "DEPLOY SMOKE",
    description: "Place a smoke grenade within range"
});
```
if you have templatemacro module installed, you can use the following options:

**Dangerous zone** (deals damage when entered):

```javascript
await api.placeZone(reactorToken, {
    size: 1,
    type: "Blast",
    dangerous: {
        damageType: "burn",
        damageValue: 5
    },
    title: "SCORCHER MISSILE",
    description: "Place a Blast 1 dangerous zone"
});
```

**Soft Cover zone** (applies cover_soft status to tokens inside):

```javascript
const result = await api.placeZone(reactorToken, {
    range: 5,
    size: 1,
    type: "Blast",
    fillColor: "#808080",
    borderColor: "#ffffff",
    statusEffects: ["cover_soft"],
    title: "SMOKE GRENADE",
    description: "Deploy a Blast 1 smoke zone within range"
});
```

---

#### `placeToken(options)`

Interactive token placement. Marks positions with orange highlights before spawning. Includes spawn effects and onSpawn callbacks.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `options.actor` | `Actor` | `null` | The actor to link spawned tokens to |
| `options.prototypeToken` | `Object` | *required* | Prototype token data (e.g. `actor.prototypeToken.toObject()`) |
| `options.range` | `number` | `null` | Max placement range in grid units (`null` = unlimited) |
| `options.count` | `number` | `1` | Number of tokens to place. `-1` for unlimited |
| `options.extraData` | `Object` | `{}` | Extra data merged into each spawned token document |
| `options.origin` | `Token\|{x,y}` | `null` | Origin point: a Token (range from token), or a pixel position (snapped to nearest hex, treated as size 1) |
| `options.onSpawn` | `Function` | `null` | Async callback `(newTokenDoc, originToken) => {}` called after each spawn |
| `options.title` | `string` | `"PLACE TOKEN"` | Info card header text |
| `options.description` | `string` | `""` | Info card description text |
| `options.icon` | `string` | `"fas fa-user-plus"` | Info card header icon (FontAwesome class) |
| `options.headerClass` | `string` | `""` | Extra CSS class for the info card header |

**Returns:** `Promise<Array<TokenDocument>|null>` — spawned token documents, or `null` if cancelled

**Controls:**
- **Left-click:** Place an orange marker (no spawn yet)
- **Right-click:** Undo last placed marker
- **Confirm button:** Spawn all placed tokens
- **Cancel / ESC:** Cancel without spawning

```javascript
const actor = game.actors.getName("Grunt");
const spawned = await api.placeToken({
    actor,
    prototypeToken: actor.prototypeToken.toObject(),
    range: 5,
    count: 3,
    origin: myToken,
    title: "DEPLOY DRONES",
    description: "Place up to 3 drones within range 5"
});
```

**With onSpawn callback (apply effect after each spawn):**

```javascript
await api.placeToken({
    actor,
    prototypeToken: actor.prototypeToken.toObject(),
    origin: myToken,
    count: 1,
    onSpawn: async (tokenDoc, originToken) => {
        await api.applyFlaggedEffectToTokens({
            tokens: [tokenDoc.object],
            effectNames: ["Exposed"],
            duration: { label: 'end', turns: 1 }
        });
    }
});
```

---

#### `startChoiceCard(options)`

Interactive choice card. Supports "OR" (pick one) and "AND" (pick all sequentially) modes.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `options.mode` | `string` | `"or"` | `"or"` (pick one, done) or `"and"` (must complete all) |
| `options.choices` | `Array<Object>` | *required* | Array of choice objects (see below) |
| `options.title` | `string` | `"CHOICE"` | Info card header text |
| `options.description` | `string` | `""` | Info card description text |
| `options.icon` | `string` | `"fas fa-list"` | Info card header icon (FontAwesome class) |
| `options.headerClass` | `string` | `""` | Extra CSS class for the info card header |

**Choice object:**

| Property | Type | Description |
|----------|------|-------------|
| `text` | `string` | Display text for the choice |
| `icon` | `string` | Optional FontAwesome icon class (e.g. `"fas fa-shield"`) |
| `callback` | `Function` | Async function called when this choice is selected |
| `data` | `any` | Optional data passed to the callback |

**Returns:** `Promise<true|null>` — `true` on completion, `null` if cancelled

**OR mode** — pick one and done:

```javascript
await api.startChoiceCard({
    mode: "or",
    title: "CHOOSE DAMAGE TYPE",
    description: "Select the damage type for this attack",
    choices: [
        { text: "Kinetic", icon: "fas fa-crosshairs", callback: async (d) => { /* apply kinetic */ }, data: "kinetic" },
        { text: "Energy", icon: "fas fa-bolt", callback: async (d) => { /* apply energy */ }, data: "energy" },
        { text: "Explosive", icon: "fas fa-bomb", callback: async (d) => { /* apply explosive */ }, data: "explosive" }
    ]
});
```

**AND mode** — complete all sequentially (card hides during each callback, reopens with completed items greyed out):

```javascript
await api.startChoiceCard({
    mode: "and",
    title: "DEPLOY SYSTEMS",
    description: "Activate all systems",
    choices: [
        { text: "Deploy Shield", icon: "fas fa-shield", callback: async () => { /* deploy shield logic */ } },
        { text: "Launch Drone", icon: "fas fa-paper-plane", callback: async () => { /* launch drone logic */ } }
    ]
});
```

---

#### `getGridDistance(pos1, pos2)`

Calculate distance between two pixel positions in grid units. Supports both hex and square grids.

| Parameter | Type | Description |
|-----------|------|-------------|
| `pos1` | `{x, y}` | First position in pixels |
| `pos2` | `{x, y}` | Second position in pixels |

**Returns:** `number` — distance in grid units

---

#### `drawRangeHighlight(casterToken, range, color, alpha)`

Draw a range highlight around a token. Returns the PIXI.Graphics object for cleanup.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `casterToken` | `Token` | | Token to center on |
| `range` | `number` | | Range in grid units |
| `color` | `number` | `0x00ff00` | Hex color |
| `alpha` | `number` | `0.2` | Opacity |

**Returns:** `PIXI.Graphics` — call `canvas.stage.removeChild(result)` to clean up

---

## Trigger Types & Data

Every trigger passes a data object to evaluate/activation functions. All data objects also receive `distanceToTrigger` (distance from the reactor to the triggering token) when processed by the activation system.

### Attack Triggers

#### `onInitAttack`

Fires when an attack is initiated (before the Attack HUD is shown).

```javascript
{
    triggeringToken: Token,
    weapon: Item,
    targets: Array<Token>,      // Initial targets
    actionName: string,
    tags: Array,
    actionData: Object
}
```

#### `onAttack`

Fires when an attack roll is made (before hit/miss is determined).

```javascript
{
    triggeringToken: Token,     // The attacker
    weapon: Item,               // The weapon used
    targets: Array<Token>,      // Targeted tokens
    attackType: string,         // "Ranged", "Melee", etc.
    actionName: string,         // Weapon/attack name
    tags: Array,                // Weapon tags
    actionData: Object          // Full Lancer flow action data
}
```

#### `onHit`

Fires when an attack hits.

```javascript
{
    triggeringToken: Token,
    weapon: Item,
    targets: Array<{target: Token, roll: number, crit: boolean}>,
    attackType: string,
    actionName: string,
    tags: Array,
    actionData: Object
}
```

#### `onMiss`

Fires when an attack misses.

```javascript
{
    triggeringToken: Token,
    weapon: Item,
    targets: Array<{target: Token, roll: number}>,
    attackType: string,
    actionName: string,
    tags: Array,
    actionData: Object
}
```

#### `onDamage`

Fires when damage is applied.

```javascript
{
    triggeringToken: Token,
    weapon: Item,
    target: Token,              // Single target that took damage
    damages: Array<number>,     // Damage amounts per type
    types: Array<string>,       // Damage types (Kinetic, Energy, etc.)
    isCrit: boolean,
    isHit: boolean,
    attackType: string,
    actionName: string,
    tags: Array,
    actionData: Object
}
```

### Tech Triggers

#### `onInitTechAttack`

Fires when a tech attack is initiated (before the Attack HUD is shown).

```javascript
{
    triggeringToken: Token,
    techItem: Item,
    targets: Array<Token>,      // Initial targets
    actionName: string,
    isInvade: boolean,
    tags: Array,
    actionData: Object
}
```

#### `onTechAttack`

Fires when a tech attack is made.

```javascript
{
    triggeringToken: Token,
    techItem: Item,             // The tech system used
    targets: Array<Token>,
    actionName: string,
    isInvade: boolean,          // true if this is an Invade action
    tags: Array,
    actionData: Object
}
```

#### `onTechHit`

Fires when a tech attack hits.

```javascript
{
    triggeringToken: Token,
    techItem: Item,
    targets: Array<{target: Token, roll: number, crit: boolean}>,
    actionName: string,
    isInvade: boolean,
    tags: Array,
    actionData: Object
}
```

#### `onTechMiss`

Fires when a tech attack misses.

```javascript
{
    triggeringToken: Token,
    techItem: Item,
    targets: Array<{target: Token, roll: number}>,
    actionName: string,
    isInvade: boolean,
    tags: Array,
    actionData: Object
}
```

### Movement

#### `onMove`

Fires when a token moves.

```javascript
{
    triggeringToken: Token,
    distanceMoved: number,      // Grid distance moved this drag
    elevationMoved: number,     // New elevation value
    startPos: { x, y },        // Position before the move
    endPos: { x, y },          // Position after the move
    isDrag: boolean,
    moveInfo: {
        isInvoluntary: boolean,
        isTeleport: boolean,
        isBoost: boolean,       // Only with experimental boost detection
        boostSet: Array<number> // Boost numbers crossed (1-based)
    }
}
```

#### `onKnockback`

Fires when a token is pushed or pulled via the interactive tool or `knockbackStep`.

```javascript
{
    triggeringToken: Token,    // The actor who initiated the push/pull
    range: number,             // Max distance of the push/pull
    pushedActors: Array<Actor> // List of actors that were moved
}
```

### Turn Events

#### `onTurnStart`

Fires at the start of a combat turn.

```javascript
{
    triggeringToken: Token
}
```

#### `onTurnEnd`

Fires at the end of a combat turn.

```javascript
{
    triggeringToken: Token
}
```

### Status Effects

#### `onStatusApplied`

Fires when a status effect is applied to a token.

```javascript
{
    triggeringToken: Token,
    statusId: string,           // e.g. "prone", "immobilized", "stunned"
    effect: ActiveEffect
}
```

#### `onStatusRemoved`

Fires when a status effect is removed.

```javascript
{
    triggeringToken: Token,
    statusId: string,
    effect: ActiveEffect
}
```

### Damage & Structure

#### `onStructure`

Fires when a mech takes structure damage.

```javascript
{
    triggeringToken: Token,
    remainingStructure: number,
    rollResult: number          // Structure table roll total
}
```

#### `onStress`

Fires when a mech takes stress (overheat).

```javascript
{
    triggeringToken: Token,
    remainingStress: number,
    rollResult: number          // Stress table roll total
}
```

#### `onHeat`

Fires when heat is gained.

```javascript
{
    triggeringToken: Token,
    heatGained: number,
    currentHeat: number,
    inDangerZone: boolean       // true if at or above half max heat
}
```

#### `onDestroyed`

Fires when a mech is destroyed.

```javascript
{
    triggeringToken: Token
}
```

#### `onHPRestored`

Fires when HP is restored.

```javascript
{
    triggeringToken: Token,
    hpRestored: number,
    currentHP: number,
    maxHP: number
}
```

#### `onHpLoss`

Fires when HP is lost.

```javascript
{
    triggeringToken: Token,
    hpLost: number,
    currentHP: number           // HP after the loss
}
```

#### `onClearHeat`

Fires when heat is cleared.

```javascript
{
    triggeringToken: Token,
    heatCleared: number,
    currentHeat: number         // Heat after clearing
}
```

### Other

#### `onInitCheck`

Fires before a stat check (HULL, AGI, SYS, ENG) is rolled. Allows modifying the check (e.g. adding bonuses) before the result is determined.

```javascript
{
    triggeringToken: Token,
    statName: string,           // "HULL", "AGI", "SYS", "ENG"
    checkAgainstToken: Token,   // The token being checked against (if any)
    targetVal: number           // The difficulty value (e.g. Save Target)
}
```

#### `onCheck`

Fires when a stat check (HULL, AGI, SYS, ENG) is performed.

```javascript
{
    triggeringToken: Token,
    statName: string,           // "HULL", "AGI", "SYS", "ENG"
    roll: Roll,                 // The foundry Roll object
    total: number,              // The total result
    success: boolean,           // Whether it met the difficulty
    checkAgainstToken: Token,   // The token being checked against (if any)
    targetVal: number           // The difficulty value (e.g. Save Target)
}
```

#### `onActivation`

Fires when an item/action is activated (via SimpleActivationFlow or SystemFlow).

```javascript
{
    triggeringToken: Token,
    actionType: string,         // "Quick", "Full", "Reaction", "Protocol", "Free"
    actionName: string,
    item: Item,                 // null for non-item actions
    actionData: Object
}
```

---

## Evaluate Function

The evaluate function determines whether an activation should trigger. It's called for every potential reactor token when a trigger fires.

**Signature:**

```javascript
async function evaluate(triggerType, triggerData, reactorToken, item, activationName) {
    // triggerType  - string, e.g. "onMove", "onDamage"
    // triggerData  - the trigger data object (see above), plus distanceToTrigger
    // reactorToken - the token that might react
    // item         - the item associated with this activation (null for general activations)
    // activationName - the name of the activation

    return true;  // or false
}
```

**Example: only trigger when target is within 5 spaces:**

```javascript
async function evaluate(triggerType, triggerData, reactorToken, item, activationName) {
    return triggerData.distanceToTrigger <= 5;
}
```

**Example: only trigger on critical hits against self:**

```javascript
async function evaluate(triggerType, triggerData, reactorToken, item, activationName) {
    if (!triggerData.targets) return false;
    return triggerData.targets.some(t => t.target?.id === reactorToken.id && t.crit);
}
```

---

## Activation Function

The activation code runs when the user clicks Activate (manual mode) or immediately on trigger (auto mode).

**Signature:**

```javascript
async function activate(triggerType, triggerData, reactorToken, item, activationName) {
    // Same parameters as evaluate
}
```

**Example: apply an effect on activation:**

```javascript
async function activate(triggerType, triggerData, reactorToken, item, activationName) {
    const api = game.modules.get('lancer-automations').api;
    await api.applyFlaggedEffectToTokens({
        tokens: [reactorToken],
        effectNames: ["Immobilized"],
        duration: { label: 'end', turns: 1 },
        useTokenAsOrigin: true
    });
}
```

---

## Activation Object Structure

The full structure of an activation config object, used by both item-based and general activations:

```javascript
{
    // Trigger configuration
    triggers: ["onMove", "onDamage"],   // Which triggers to listen for
    enabled: true,                       // Whether this activation is active

    // Display
    triggerDescription: "When a hostile moves within range",
    effectDescription: "Make an attack as a reaction",
    actionType: "Reaction",             // "Reaction", "Free Action", "Quick Action",
                                        // "Full Action", "Protocol", "Other"
    frequency: "1/Round",               // "1/Round", "Unlimited", "1/Scene", "1/Combat", "Other"

    // Who can react
    triggerSelf: false,                  // Can the triggering token react to its own trigger?
    triggerOther: true,                  // Can other tokens react?
    consumesReaction: true,              // Does activating consume the token's reaction?
    outOfCombat: false,                  // Works outside of combat?

    // Filters
    onlyOnSourceMatch: false,            // Only trigger if the source item/action matches
    dispositionFilter: ["hostile"],      // Filter by disposition: "friendly", "hostile",
                                         // "neutral", "secret"

    // Evaluate
    evaluate: "return true;",            // String (code) or Function

    // Activation
    activationType: "code",              // "flow", "code", "macro", "none"
    activationMode: "after",             // "after" (run after flow) or "instead" (replace flow)
    activationCode: "",                  // String (code) or Function
    activationMacro: "",                 // Macro name (if activationType is "macro")
    autoActivate: false,                 // Skip popup, run automatically

    // Item-specific
    reactionPath: "",                    // Path to action in item (e.g., "ranks[0].actions[0]")
    onInit: "",                          // Code to run when token is created
}
```

---

## Consumption Object

Used in `extraOptions.consumption` for effects and `options.consumption` for bonuses:

```javascript
{
    trigger: "onDamage",        // Which trigger consumes a charge
    originId: "tokenId123",     // Only consume when this token is involved
    grouped: true,              // Auto-generate a groupId for all effects in this call
    groupId: "customId",        // Or provide your own groupId to share across separate calls
    evaluate: null,             // Custom consumption check: (triggerType, data, token, effect) => boolean
    itemLid: "weapon_lid",     // Only consume when this item LID is the source (comma-separated for multiple)
    actionName: "Skirmish",     // Only consume when this action name matches
    isBoost: true,              // Only consume on boost movement
    minDistance: 1,             // Only consume when distance moved >= this
    checkType: "Agility",      // Only consume when this stat is checked
    checkAbove: 10,             // Only consume when check total >= this
    checkBelow: 5               // Only consume when check total <= this
}
```

---

## How To: Register Default Activations by Code

Use the `lancer-automations.ready` hook to register activations from your own module or macro:

```javascript
Hooks.on('lancer-automations.ready', (api) => {
    // Item-based: only tokens with this item can react
    api.registerDefaultItemReactions({
        "my_custom_weapon_lid": {
            itemType: "mech_weapon",
            reactions: [{
                triggers: ["onHit"],
                triggerSelf: true,
                triggerOther: false,
                onlyOnSourceMatch: true,
                autoActivate: true,
                activationType: "code",
                activationMode: "after",
                evaluate: async function (triggerType, triggerData, reactorToken, item, activationName) {
                    return triggerData.targets?.some(t => t.crit);
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                    ui.notifications.info(`${activationName} scored a critical hit!`);
                }
            }]
        }
    });

    // General: all tokens can react
    api.registerDefaultGeneralReactions({
        "My Custom Trigger": {
            triggers: ["onDamage"],
            triggerSelf: false,
            triggerOther: true,
            consumesReaction: false,
            autoActivate: false,
            evaluate: async function (triggerType, triggerData, reactorToken, item, activationName) {
                return triggerData.target?.id === reactorToken.id;
            },
            activationType: "flow",
            activationMode: "after"
        }
    });
});
```

---

## How To: Create Status Effects with Consumption

Apply an effect with charges that get consumed when a specific trigger fires:

```javascript
const api = game.modules.get('lancer-automations').api;

// Apply Soft Cover with 2 charges, consumed on boost
await api.applyFlaggedEffectToTokens({
    tokens: [myToken],
    effectNames: ["cover_soft"],
    note: "Soft Cover (2 charges)",
    duration: { label: 'indefinite', turns: null },
    useTokenAsOrigin: true
}, {
    stack: 2,
    consumption: {
        trigger: "onMove",
        originId: myToken.id,
        isBoost: true
    }
});
```

**Shared consumption with `grouped`:**

When multiple effects are grouped, consuming a charge from one decrements all of them. When charges hit 0, all effects in the group are removed.

Use `grouped: true` to auto-generate a groupId for all effects in the same call, or provide your own `groupId`.

```javascript
// grouped: true auto-generates a groupId for all effects in this call
await api.applyFlaggedEffectToTokens({
    tokens: [target],
    effectNames: [
        "lancer.statusIconsNames.resistance_kinetic",
        "lancer.statusIconsNames.resistance_energy"
    ],
    duration: { label: 'indefinite', turns: null },
    useTokenAsOrigin: false,
    customOriginId: target.id
}, {
    stack: 3,
    consumption: {
        trigger: "onDamage",
        originId: target.id,
        grouped: true
    }
});
```

**Custom consumption evaluate:**

```javascript
await api.applyFlaggedEffectToTokens({
    tokens: [myToken],
    effectNames: ["My Effect"],
    duration: { label: 'indefinite', turns: null },
    useTokenAsOrigin: true
}, {
    stack: 1,
    consumption: {
        trigger: "onDamage",
        originId: myToken.id,
        evaluate: function (triggerType, triggerData, effectBearerToken, effect) {
            // Only consume if damage is Kinetic
            return triggerData.types?.includes("Kinetic");
        }
    }
});
```

---

## How To: Create Bonuses by Code

```javascript
const api = game.modules.get('lancer-automations').api;
const actor = token.actor;
```

**Accuracy bonus (all attacks, 1 round):**

```javascript
await api.addGlobalBonus(actor, {
    name: "+1 Accuracy",
    val: 1,
    type: "accuracy",
    targetTypes: ["all"]
}, {
    duration: "end",
    durationTurns: 1,
    origin: token
});
```

**Damage bonus (specific weapon, consumed on use):**

```javascript
await api.addGlobalBonus(actor, {
    name: "Bonus Damage",
    val: 2,
    type: "damage",
    damage: [{ type: "Kinetic", val: 2 }],
    targetTypes: ["all"],
    itemLids: ["my_weapon_lid"]
}, {
    duration: "indefinite",
    consumption: {
        trigger: "onDamage",
        originId: token.id
    }
});
```

**Stat bonus (increase max HP):**

```javascript
await api.addGlobalBonus(actor, {
    name: "+2 Max HP",
    val: 2,
    type: "stat",
    stat: "system.hp.max"
}, {
    duration: "end",
    durationTurns: 1,
    origin: token
});
```

**Stat bonus (current resource — e.g., overshield):**

Current resources like HP, Heat, and Overshield use direct `actor.update()`

```javascript
await api.addGlobalBonus(actor, {
    name: "+5 Overshield",
    val: 5,
    type: "stat",
    stat: "system.overshield.value"
}, {
    duration: "end",
    durationTurns: 1,
    origin: token
});
```

**Difficulty with custom condition:**

```javascript
await api.addGlobalBonus(actor, {
    name: "Impaired Attacks",
    val: 1,
    type: "difficulty",
    targetTypes: ["attack"],
    condition: async (state, actor, data, context) => { return state.data?.title?.includes('Melee'); }
}, {
    duration: "start",
    durationTurns: 2,
    origin: token
});
```

**Removing a bonus:**

```javascript
const bonusId = await api.addGlobalBonus(actor, { ... }, { ... });

// Later:
await api.removeGlobalBonus(actor, bonusId);
```

---

#### `knockBackToken(tokens, distance, options)`

Push/pull tokens on the grid. Opens interactive destination selection for each token.
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tokens` | `Array<Token>` | *required* | The tokens to knock back |
| `distance` | `number` | *required* | Distance in grid spaces |
| `options`   | `Object` | `{}` | Optional parameters |
| `options.title` | `string` | `"Knockback"` | Undo card title |

**Returns:** `Promise<void>`

---

#### `revertMovement(token, destination)`

Revert a token's movement to a specific position. Typically used in `onMove` triggers to cancel movement.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `token` | `Token` | *required* | The token to revert |
| `destination` | `{x, y}` | `null` | Position `{x, y}` to revert to. If null, does nothing. |

**Returns:** `Promise<void>`

#### `triggerFlaggedEffectImmunity(token, effectNames, source, notify)`

Check if a token has any of the specified effects, remove them, and trigger a chat message mentioning the token's immunity.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `token` | `Token\|TokenDocument` | *required* | The token to check |
| `effectNames` | `Array<string>\|string` | *required* | List of effect names (can be partial matches) |
| `source` | `Item\|string` | `""` | Optional item or text for "with [Source]" mention |
| `notify` | `boolean` | `true` | Show a chat notification ("Immunity to" format) |

**Returns:** `Promise<void>`
