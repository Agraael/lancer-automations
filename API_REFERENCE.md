# Lancer Automations — API Reference

## Summary

- [Accessing the API](#accessing-the-api)
- [Exposed Functions](#exposed-functions)
  - **Effect Management**: [`applyFlaggedEffectToTokens`](#applyflaggedeffecttotokensoptions-extraoptions), [`removeFlaggedEffectToTokens`](#removeflaggedeffecttotokensoptions), [`findFlaggedEffectOnToken`](#findflaggedeffectontokentoken-identifier), [`consumeEffectCharge`](#consumeeffectchargeeffect), [`executeEffectManager`](#executeeffectmanageroptions)
  - **Global Bonuses**: [`addGlobalBonus`](#addglobalbonusactor-bonusdata-options), [`removeGlobalBonus`](#removeglobalbonusactor-bonusid-skipeffectremoval), [`getGlobalBonuses`](#getglobalbonusesactor), [`addConstantBonus`](#addconstantbonusactor-bonusdata), [`removeConstantBonus`](#removeconstantbonusactor-bonusid), [`getConstantBonuses`](#getconstantbonusesactor), [`injectBonusToNextRoll`](#injectbonustonextrollactor-bonus)
  - **Activation Registration**: [`registerDefaultItemReactions`](#registerdefaultitemreactionsreactions), [`registerDefaultGeneralReactions`](#registerdefaultgeneralreactionsreactions)
  - **Spatial / Distance**: [`getActorMaxThreat`](#getactormaxthreatactor), [`getTokenDistance`](#gettokendistancetoken1-token2), [`getMinGridDistance`](#getmingriddistancetoken1-token2-overridepos1), [`isHostile`](#ishostiletoken1-token2), [`isFriendly`](#isfriendlytoken1-token2)
  - **Utilities**: [`executeStatRoll`](#executestatrollactor-stat-title-target-extradata), [`executeDamageRoll`](#executedamagerollattacker-targets-damagevalue-damagetype-title-options-extradata), [`executeBasicAttack`](#executebasicattackactor-options-extradata), [`executeTechAttack`](#executetechattackactor-options-extradata), [`executeSimpleActivation`](#executesimpleactivationactor-options-extradata), [`clearMoveData`](#clearmovedatatokendocid), [`getCumulativeMoveData`](#getcumulativemovedatatokendocid), [`clearMovementHistory`](#clearmovementhistorytokens-revert), [`getTokenCells`](#gettokencellstoken), [`getMaxGroundHeightUnderToken`](#getmaxgroundheightundertokentoken-terrainapi), [`openItemBrowser`](#openitembrowsertargetinput), [`drawThreatDebug`](#drawthreatdebugtoken), [`drawDistanceDebug`](#drawdistancedebug), [`knockBackToken`](#knockbacktokentokens-distance-options), [`revertMovement`](#revertmovementtoken-destination), [`triggerFlaggedEffectImmunity`](#triggerflaggedeffectimmunitytoken-effectnames-source-notify)
  - **Interactive Tools**: [`chooseToken`](#choosetokencastertoken-options), [`placeZone`](#placezonecastertoken-options), [`placeToken`](#placetokenoptions), [`startChoiceCard`](#startchoicecardoptions), [`deployWeaponToken`](#deployweapontokenweapon-owneractor-origintoken-options), [`pickupWeaponToken`](#pickupweapontokenownertoken), [`resolveDeployable`](#resolvedeployabledeployableorlid-owneractor), [`placeDeployable`](#placedeployableoptions), [`beginDeploymentCard`](#begindeploymentcardoptions), [`openDeployableMenu`](#opendeployablemenuactor), [`recallDeployable`](#recalldeployableownertoken), [`openThrowMenu`](#openthrowmenuactor), [`beginThrowWeaponFlow`](#beginthrowweaponflowweapon), [`getGridDistance`](#getgriddistancepos1-pos2), [`drawRangeHighlight`](#drawrangehighlightcastertoken-range-color-alpha)
- [Trigger Types & Data](#trigger-types--data)
- [Evaluate Function](#evaluate-function)
- [Activation Function](#activation-function)
- [Activation Object Structure](#activation-object-structure)
- [Consumption Object](#consumption-object)
- [How To...](#how-to-register-default-activations-by-code)

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
| `effectNames` | `string \| Array<string> \| Object \| Array<Object>` | *required* | Pre-registered effect name(s), existing custom effect name(s), or custom effect object(s) `{ name: string, icon: string, isCustom: boolean, stack?: number }` |
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

**Example (Applying a built-in or existing custom effect):**
```javascript
await api.applyFlaggedEffectToTokens({
    tokens: [targetToken],
    effectNames: ["prone"], // Or an existing custom effect e.g. "My Effect"
    duration: { label: 'end', turns: 1, rounds: 0 }
});
```

**Example (Creating a new custom effect on the fly):**
```javascript
await api.applyFlaggedEffectToTokens({
    tokens: [targetToken],
    effectNames: [{
        name: "My Custom Status",
        icon: "modules/lancer-automations/icons/grapple.svg", // Optional, defaults to mystery-man.svg
        isCustom: true 
    }],
    note: "Grappling the target",
    duration: { label: 'start', turns: 2, rounds: 0 },
    useTokenAsOrigin: true
});
```

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
| `rollTypes` | `Array<string>` | Flow type filters: `["all"]`, `["attack"]`, `["check"]`, `["damage"]`, etc. |
| `condition` | `string \| function` | JS condition — function reference or string expression. Args: `(state, actor, data, context)`, returns boolean. Supports async. |
| `itemLids` | `Array<string>` | Item LID filters |
| `applyTo` | `Array<string>` | Token ID filters: only applies if the actor/target has these IDs |
| `applyToTargetter` | `boolean` | If true, the bonus is checked on the target but applied to the attacker |
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

#### `addConstantBonus(actor, bonusData)`

Add a static, persistent bonus to an actor without an attached status effect.

| Parameter | Type | Description |
|-----------|------|-------------|
| `actor` | `Actor` | The actor to add the bonus to |
| `bonusData` | `Object` | The bonus object (same properties as `addGlobalBonus`) |

**Returns:** `Promise<void>`

---

#### `getConstantBonuses(actor)`

Get all constant bonuses for an actor.

**Returns:** `Array<Object>` — array of bonus data objects.

---

#### `removeConstantBonus(actor, bonusId)`

Remove a constant bonus by its ID.

| Parameter | Type | Description |
|-----------|------|-------------|
| `actor` | `Actor` | The actor to remove the bonus from |
| `bonusId` | `string` | The ID of the bonus to remove |

**Returns:** `Promise<void>`

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

#### `getMinGridDistance(token1, token2, overridePos1)`

Calculate the shortest grid distance between two tokens, natively taking token size and shape into account.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `token1` | `Token` | *required* | First token (measuring from) |
| `token2` | `Token` | *required* | Second token (measuring to) |
| `overridePos1` | `{x, y}` | `null` | Optional origin coordinate override for token1 |

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

#### `executeBasicAttack(actor, options, extraData)`

Perform a Basic Attack flow.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `actor` | `Actor` | *required* | The actor performing the attack |
| `options` | `Object` | `{}` | Item/flow options |
| `extraData` | `Object` | `{}` | Extra data to inject into flow state |

**Returns:** `Promise<boolean>`

---

#### `executeTechAttack(actor, options, extraData)`

Perform a Tech Attack flow (Invade).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `actor` | `Actor` | *required* | The actor performing the attack |
| `options` | `Object` | `{}` | Item/flow options |
| `extraData` | `Object` | `{}` | Extra data to inject into flow state |

**Returns:** `Promise<boolean>`

---

#### `executeSimpleActivation(actor, options, extraData)`

Perform a Simple Activation flow (useful for traits/features).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `actor` | `Actor` | *required* | The actor activating the item |
| `options` | `Object` | `{}` | Item/flow options |
| `extraData` | `Object` | `{}` | Extra data to inject into flow state |

**Returns:** `Promise<boolean>`

---

#### `clearMoveData(tokenDocId)`

Reset cumulative movement data for a token. Automatically called at the start of each turn.

---

#### `getCumulativeMoveData(tokenDocId)`

Get the current cumulative movement distance for a token this turn.

**Returns:** `number` (0 if no data)

---

#### `clearMovementHistory(tokens, revert)`

Clear the `elevationruler` movement history for tokens to permanently cancel ongoing path measurements.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tokens` | `Array<Token>` | *required* | Tokens to clear |
| `revert` | `boolean` | `false` | Whether to also revert movement visually to start |

**Returns:** `Promise<void>`

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
| `options.noCard` | `boolean` | `false` | Skip the info card; auto-confirm after placing the required count |

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

#### `deployWeaponToken(weapon, ownerActor, originToken, options)`

Deploy a weapon as a token on the ground with interactive placement. Creates a "Template Throw" deployable actor if needed, then uses `placeToken` for placement. The weapon is disabled on spawn.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `weapon` | `Item` | *required* | The weapon item to deploy |
| `ownerActor` | `Actor` | *required* | The actor who owns the weapon |
| `originToken` | `Token` | `null` | The token to measure range from |
| `options.range` | `number` | `1` | Placement range |
| `options.title` | `string` | `"DEPLOY WEAPON"` | Card title |
| `options.description` | `string` | `""` | Card description |
| `options.at` | `Token\|{x,y}` | `null` | Origin override for range measurement |

**Returns:** `Promise<Array<TokenDocument>|null>`

---

#### `pickupWeaponToken(ownerToken)`

Pick up a thrown weapon token. Shows a `chooseToken` card restricted to the owner's thrown weapons (green highlighted). Re-enables the weapon and deletes the deployed token.

| Parameter | Type | Description |
|-----------|------|-------------|
| `ownerToken` | `Token` | The token whose actor owns the thrown weapons |

**Returns:** `Promise<{weaponName, weaponId}|null>`

---

#### `resolveDeployable(deployableOrLid, ownerActor)`

Resolve a deployable actor from either a direct Actor reference or a LID string. Searches the actor folder (owned by the given actor) first, then compendiums.

| Parameter | Type | Description |
|-----------|------|-------------|
| `deployableOrLid` | `Actor\|string` | A deployable Actor or a LID string (e.g. `"dep_turret_drone"`) |
| `ownerActor` | `Actor` | The actor that owns the deployable |

**Returns:** `Promise<{deployable: Actor|null, source: string|null}>` — source is `'actor'`, `'compendium'`, or `null`

---

#### `placeDeployable(options)`

Place a deployable token on the scene with interactive placement. Handles compendium actor creation, use consumption, and token flagging.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `options.deployable` | `Actor\|string` | *required* | A deployable Actor or LID string (resolved via `resolveDeployable`) |
| `options.ownerActor` | `Actor` | *required* | The actor that owns the deployable |
| `options.systemItem` | `Item` | `null` | The system/item that grants the deployable (for use consumption) |
| `options.consumeUse` | `boolean` | `false` | Whether to consume a use from systemItem |
| `options.fromCompendium` | `boolean` | `false` | Whether the deployable is from a compendium (creates a new actor with owner metadata) |
| `options.width` | `number` | `null` | Token width override (defaults to `deployable.prototypeToken.width`) |
| `options.height` | `number` | `null` | Token height override (defaults to `deployable.prototypeToken.height`) |
| `options.range` | `number` | `1` | Placement range (`null` for unlimited) |
| `options.count` | `number` | `1` | Number of tokens to place (`-1` for unlimited) |
| `options.at` | `Token\|{x,y}` | `null` | Origin override for range measurement. When `null`, uses ownerActor's active token |
| `options.title` | `string` | `"DEPLOY"` | Card title |
| `options.description` | `string` | `""` | Card description |
| `options.noCard` | `boolean` | `false` | Skip the info card; auto-confirm after placing |

**Returns:** `Promise<Array<TokenDocument>|null>`

```javascript
await api.placeDeployable({
    deployable: "dep_turret_drone",
    ownerActor: actor,
    systemItem: turretDronesSystem,
    consumeUse: true,
    range: 3,
    count: 2,
    title: "DEPLOY TURRET DRONE"
});
```

---

#### `beginDeploymentCard(options)`

Show a deployment card for a specific item's deployables. Each deployable is listed as a clickable row. Clicking one triggers `placeDeployable` with `noCard: true`. The card stays open until the user clicks Confirm or Cancel. Shows uses and charges if present.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `options.actor` | `Actor` | *required* | The owner actor |
| `options.item` | `Item` | *required* | The system/frame item that has deployables |
| `options.deployableOptions` | `Array<Object>` | `[]` | Per-index options overrides for `placeDeployable`. Each entry corresponds to a deployable LID in the item's array. e.g. `[{ range: 3, count: 2 }, { range: 1 }]` |

**Returns:** `Promise<true|null>` — `true` if confirmed, `null` if cancelled

```javascript
await api.beginDeploymentCard({
    actor,
    item: turretDronesSystem,
    deployableOptions: [
        { range: 3, count: 2 },  // first deployable LID
        { range: 1, count: 1 }   // second deployable LID
    ]
});
```

---

#### `openDeployableMenu(actor)`

Open a dialog menu showing all deployables available to an actor (scans all systems and frame core_system). Allows selecting and deploying them with unlimited range. Supports compendium deployables with a "Generate" button for GMs.

| Parameter | Type | Description |
|-----------|------|-------------|
| `actor` | `Actor` | The actor whose deployables to show |

**Returns:** `Promise<void>`

---

#### `recallDeployable(ownerToken)`

Recall (pick up) a deployed deployable from the scene. Shows a `chooseToken` card restricted to tokens deployed by the owner. Deployables **without** `system.recall` are highlighted in red as a warning. Deletes the token on recall.

| Parameter | Type | Description |
|-----------|------|-------------|
| `ownerToken` | `Token` | The token whose actor owns the deployables |

**Returns:** `Promise<{deployableName, deployableId}|null>`

---

### `openThrowMenu(actor)`

Opens a dialog listing all of an actor's throwable weapons for attack. Supports both mech weapons (with "Thrown" tag) and NPC features.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `actor` | `Actor` | `null` | The actor whose weapons to show. Defaults to the first controlled token's actor. |

**Example:**
```javascript
await api.openThrowMenu(actor);
```

---

#### `beginThrowWeaponFlow(weapon)`

Begin a weapon attack flow with `is_throw` pre-set to `true`, skipping the throw choice card.

| Parameter | Type | Description |
|-----------|------|-------------|
| `weapon` | `Item` | The weapon item to throw |

**Returns:** `Promise<void>`

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

#### `onPreMove`

Fires *before* a token's movement drag is finalized, allowing macros to intercept, modify, or cancel the movement cleanly. Also provides the exact grid path the token is travelling.

```javascript
{
    token: Token,
    distanceToMove: number,     // Grid distance intended for this drag
    elevationToMove: number,    // Intended new elevation value
    startPos: { x, y },         // Position before the move starts
    endPos: { x, y },           // Intended position after the move
    isDrag: boolean,
    moveInfo: {
        isInvoluntary: boolean,
        isTeleport: boolean,
        pathHexes: Array<Object> // Array of hex data describing the dragged path `[{x, y, cx, cy, isHistory, hexes}]`.
                                 // - `pathHexes.historyStartIndex` : index of the first step that was not previously confirmed.
                                 // - `pathHexes.getPathPositionAt(index)` : Returns the proper snap-adjusted `{x, y}` for interception.
    },
    cancelTriggeredMove: Function(reasonText?: string, showCard?: boolean), // Aborts the drag. If showCard is true, prompts the user to confirm the cancellation.
    changeTriggeredMove: Function(position: {x, y}, extraData?: Object, reasonText?: string, showCard?: boolean) // Reroutes the token. If showCard is true, prompts the user to confirm the reroute.
}
```

#### `onMove`

Fires when a token successfully completes a movement.

```javascript
{
    triggeringToken: Token,
    distanceMoved: number,      // Grid distance moved this drag
    elevationMoved: number,     // New elevation value
    startPos: { x, y },         // Position before the move
    endPos: { x, y },           // Position after the move
    isDrag: boolean,
    moveInfo: {
        isInvoluntary: boolean,
        isTeleport: boolean,
        pathHexes: Array<Object>, // Array of hex data describing the dragged path
        isBoost: boolean,       // Only with experimental boost detection
        boostSet: Array<number>,// Boost numbers crossed (1-based)
        isModified: boolean,    // True if an `onPreMove` interceptor modified this move
        extraData: Object       // Any custom data injected by `changeTriggeredMove`
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

#### `onUpdate`

> [!WARNING]
> This trigger fires incredibly frequently (every time any token is updated or moved on the grid). Use extreme caution when creating activations hooked to `onUpdate`, as heavy calculations will severely degrade canvas performance.

Fires on any generic token update (position, elevation, stats, statuses, etc).

```javascript
{
    triggeringToken: Token,
    document: TokenDocument,
    change: Object,             // The update data object
    options: Object             // Foundry update options context
}
```

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
    forceSynchronous: false,             // Forces the trigger flow to wait for fully synchronous resolution before resuming (e.g. for `onPreMove` intercepts)

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
    effectNames: ["lockon"],
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
    rollTypes: ["all"]
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
    rollTypes: ["all"],
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
    rollTypes: ["attack"],
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
