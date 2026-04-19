# API — Effects & Bonuses

[Back to API Reference](API_REFERENCE.md)

---

## Effect Management

<details>
<summary><b><code>applyEffectsToTokens</code></b> <sup>async</sup> → <code>Array&lt;Token&gt;</code></summary>

<br>

```js
await api.applyEffectsToTokens(options, extraOptions)
```

**`options` Object:**

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>tokens</kbd> | `Array<Token>` | *required* | Targets |
| <kbd>effectNames</kbd> | `string\|Array` | *required* | `"prone"` or `{ name, icon, isCustom }` |
| <kbd>note</kbd> | `string` | `undefined` | Flavor note |
| <kbd>duration</kbd> | `Object` | `undefined` | `{ label, turns, rounds, overrideTurnOriginId }` — when `overrideTurnOriginId` is set, duration ticks down from that token's turn instead of the target's |
| <kbd>checkEffectCallback</kbd> | `fn` | `null` | Duplicate check predicate |
| <kbd>notify</kbd> | `bool\|obj` | `true` | Unified notification config |

**`extraOptions` Object:**
`{ stack, linkedBonusId, consumption, statDirect, changes, ...customFlags }`

Any additional key-value pairs in `extraOptions` (e.g. `suppressSourceId`, `suppressSourceName`) are stored verbatim inside `flags['lancer-automations']` on each created effect. These can later be used as removal filters via `extraFlags` in `removeEffectsByNameFromTokens`.

</details>

---

<details>
<summary><b><code>removeEffectsByNameFromTokens</code></b> <sup>async</sup> → <code>Array&lt;Token&gt;</code></summary>

<br>

```js
await api.removeEffectsByNameFromTokens(options)
```

Finds all effects matching the given name(s) and removes them. This is a **find-by-name-and-delete-all-matches** operation — it removes every effect whose name matches, not a targeted removal by ID. To delete a specific known effect by ID, use `deleteEffect` instead.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>tokens</kbd> | `Array<Token>` | *required* | Tokens to remove from |
| <kbd>effectNames</kbd> | `string\|Array` | *required* | Effect name(s) to match and remove |
| <kbd>originId</kbd> | `string` | `null` | Only remove effects whose stored `originID` flag matches this value |
| <kbd>extraFlags</kbd> | `Object` | `null` | Key/value pairs that must ALL match the effect's `flags['lancer-automations']` data |
| <kbd>notify</kbd> | `bool\|Object` | `true` | Notification config |

> **Note:** `originId` and `extraFlags` are independent filters — both are applied when provided. Use `extraFlags` when the source identity was stored as a custom flag (not as `originID`).

**Example:**
```js
await api.removeEffectsByNameFromTokens({
    tokens: [targetToken],
    effectNames: ["Suppress", "impaired"],
    extraFlags: { suppressSourceId: reactorToken.id }
});
```

</details>

---

<details>
<summary><b><code>removeEffectsByName</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.removeEffectsByName(targetID, effectName, originID, extraFlags)
```

Removes effects from a single token by name. Lower-level than `removeEffectsByNameFromTokens` (which operates on arrays of tokens).

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>targetID</kbd> | `string` | *required* | The token ID to remove effects from |
| <kbd>effectName</kbd> | `string` | *required* | Effect name to match and remove |
| <kbd>originID</kbd> | `string` | `null` | Only remove effects whose stored `originID` flag matches |
| <kbd>extraFlags</kbd> | `Object` | `null` | Key/value pairs that must ALL match the effect's `flags['lancer-automations']` data |

</details>

---

<details>
<summary><b><code>deleteEffect</code></b> → <code>void</code></summary>

<br>

```js
api.deleteEffect(token, effect)
```

Deletes a specific active effect by object or ID. Unlike `removeEffectsByNameFromTokens`, this targets one exact effect — no name matching, no side effects. Routes through the GM socket automatically for non-GM users.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token\|TokenDocument\|string` | The token (or its ID) that owns the effect |
| <kbd>effect</kbd> | `ActiveEffect\|string` | The effect (or its ID) to delete |

**Example:**
```js
const effects = api.getAllEffects(target);
api.deleteEffect(target, effects[0]);
```

</details>

---

<details>
<summary><b><code>findEffectOnToken</code></b> → <code>ActiveEffect | undefined</code></summary>

<br>

```js
api.findEffectOnToken(token, identifier)
```

Searches for an effect on a token by name or predicate function.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token\|TokenDocument` | The token to search |
| <kbd>identifier</kbd> | `string\|Function` | Effect name (string) or predicate `(effect) => boolean` |

**Example — predicate search:**
```js
const effect = api.findEffectOnToken(target, e =>
    e.name === "Suppress" && e.flags?.['lancer-automations']?.suppressSourceId === reactorToken.id
);
```

</details>

---

<details>
<summary><b><code>getAllEffects</code></b> → <code>Array&lt;ActiveEffect&gt;</code></summary>

<br>

```js
api.getAllEffects(target)
```

Returns all active effects on the target, including unflagged player-added ones.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>target</kbd> | `Token\|TokenDocument\|Actor` | The target to inspect |

</details>

---

<details>
<summary><b><code>consumeEffectCharge</code></b> <sup>async</sup> → <code>boolean</code></summary>

<br>

```js
await api.consumeEffectCharge(effect)
```

Decrements the effect's stack counter by 1. If the counter reaches 0, the effect is deleted. Grouped effects (via `consumption.groupId`) share a counter and are all deleted together.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>effect</kbd> | `ActiveEffect` | The effect to consume a charge from |

Returns `true` if consumed, `false` if the effect has no consumption data.

</details>

---

<details>
<summary><b><code>triggerEffectImmunity</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.triggerEffectImmunity(token, effectNames, source, notify)
```

Removes the named effects from the token and announces immunity in chat.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>token</kbd> | `Token\|TokenDocument` | *required* | The immune token |
| <kbd>effectNames</kbd> | `string\|Array<string>` | *required* | Effect name(s) to remove |
| <kbd>source</kbd> | `Item\|string` | `""` | Source of immunity (item or text) |
| <kbd>notify</kbd> | `boolean` | `true` | Post chat notification |

</details>

---

<details>
<summary><b><code>checkEffectImmunities</code></b> → <code>Array&lt;string&gt;</code></summary>

<br>

```js
api.checkEffectImmunities(actor, effectIdOrName, effect, state)
```

Returns an array of source names (e.g. `["Immunity Bonus", "Armor Plating"]`) if the actor is immune to the named effect.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actor</kbd> | `Actor` | *required* | The actor to check |
| <kbd>effectIdOrName</kbd> | `string` | *required* | Effect ID or name to check immunity for |
| <kbd>effect</kbd> | `ActiveEffect` | `null` | Optional effect object for additional context |
| <kbd>state</kbd> | `Object` | `null` | Optional flow state |

</details>

---

<details>
<summary><b><code>deleteAllEffects</code></b> · <b><code>executeEffectManager</code></b> <sup>async</sup></summary>

<br>

```js
await api.deleteAllEffects(tokens)     // Removes ALL active effects from the provided tokens
await api.executeEffectManager(options) // Opens the Effect Manager UI
```

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>tokens</kbd> | `Array<Token\|TokenDocument>` | Tokens to clear |

</details>

---

## Global & Constant Bonuses

<details>
<summary><b><code>addGlobalBonus</code></b> <sup>async</sup> → <code>string</code> (Bonus ID)</summary>

<br>

```js
const bonusId = await api.addGlobalBonus(actor, bonusData, options)
```

**`bonusData` Object:**

<details>
<summary>Core fields (all bonus types)</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <kbd>id</kbd> | `string` | Optional custom ID |
| <kbd>name</kbd> | `string` | Display name |
| <kbd>type</kbd> | `string` | `"accuracy"`, `"difficulty"`, `"damage"`, `"stat"`, `"immunity"`, `"tag"`, `"range"`, `"multi"`, `"target_modifier"`, `"reroll"` |
| <kbd>val</kbd> | `number\|string` | Value for stat, accuracy, difficulty, tag, or range bonuses |
| <kbd>uses</kbd> | `number` | Stack count |
| <kbd>rollTypes</kbd> | `Array` | `["attack"]`, `["check"]`, etc. |
| <kbd>condition</kbd> | `string\|fn` | `(state, actor, data, context) => boolean`. **Per-bonus** gate — if false, the whole bonus is skipped. |
| <kbd>itemLids</kbd> | `Array` | LID filters |
| <kbd>applyTo</kbd> | `Array` | Token ID filters. Static — set at bonus creation. For dynamic per-target filters on `target_modifier`, see `applyToCondition` below. |

</details>

<details>
<summary>Immunity fields (type: "immunity")</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <kbd>subtype</kbd> | `string` | `"effect"`, `"damage"`, `"resistance"`, `"crit"`, `"hit"`, `"miss"` |
| <kbd>effects</kbd> | `Array` | Only for `subtype: "effect"`. List of effect/status names (e.g. `["Prone", "Immobilized"]`) |
| <kbd>damageTypes</kbd> | `Array` | Only for `subtype: "damage"` or `"resistance"`. List of damage types (e.g. `["Energy", "Kinetic"]`) |

</details>

<details>
<summary>Target modifier fields (type: "target_modifier")</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <kbd>subtype</kbd> | `string` | Attack: `"invisible"`, `"no_invisible"`, `"no_cover"`, `"soft_cover"`, `"hard_cover"`. Damage: `"ap"`, `"half_damage"`, `"paracausal"`, `"crit"`, `"hit"`, `"miss"` |
| <kbd>applyToCondition</kbd> | `string\|fn` | **Per-target** gate (complements `applyTo` and `condition`). Lambda `(target, state, reactorToken) => boolean` evaluated once per target during the attack / damage / toggle pass. Must be synchronous. Serialized via `@@fn:` — survives reloads. Useful for dynamic filters (e.g. range, target status) that can't be pinned to a static `applyTo` array. |

`"no_invisible"` forces `plugins.invisibility.data = 0` on the target, bypassing `"invisible"`.

**Example — ignore invisibility only within range 3:**
```js
await api.addConstantBonus(actor, {
    id: 'lesser-sight',
    name: 'Lesser Sight',
    type: 'target_modifier',
    subtype: 'no_invisible',
    applyToCondition: (target, state, reactorToken) => {
        const api = game.modules.get('lancer-automations')?.api;
        return api?.getTokenDistance(reactorToken, target.target) <= 3
            && target.target?.actor?.effects?.some(e => e.statuses?.has('invisible'));
    }
});
```

</details>

<details>
<summary>Tag fields (type: "tag")</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <kbd>tagName</kbd> | `string` | Name of the custom tag (e.g. `"Inaccurate"`) |
| <kbd>tagMode</kbd> | `string` | `"add"` or `"override"` |
| <kbd>removeTag</kbd> | `boolean` | If true, negates the tag instead of adding it |

</details>

<details>
<summary>Range fields (type: "range")</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <kbd>rangeType</kbd> | `string` | `"Range"`, `"Threat"`, `"Line"`, `"Blast"`, `"Burst"`, `"Cone"` |
| <kbd>rangeMode</kbd> | `string` | `"add"` (default) or `"override"` |

</details>

<details>
<summary>Reroll fields (type: "reroll")</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <kbd>rollTypes</kbd> | `Array<string>` | `"attackRoll"`, `"techAttackRoll"`, `"damageRoll"`, `"skillRoll"`, `"structureRoll"`, `"stressRoll"`. Empty = all. |

Offered via a choice card before `onRoll` fires. Consumed on Use.

</details>

<details>
<summary>Multi / Damage fields</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <kbd>bonuses</kbd> | `Array` | Only for `type: "multi"`. Array of sub-bonus objects. |
| <kbd>damage</kbd> | `Array` | Damage bonus: `[{ type, val }]` |
| <kbd>stat</kbd> | `string` | Property path (e.g. `system.hp.max`) |

</details>

<br>

**`options` Object:**
`{ duration ("indefinite"|"end"|"start"), durationTurns, origin, consumption }`

</details>

---

<details>
<summary><b><code>removeGlobalBonus</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.removeGlobalBonus(actor, bonusIdOrPredicate, skipEffectRemoval)
```

Removes one or more global bonuses from an actor. Also deletes linked active effects unless `skipEffectRemoval` is true.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actor</kbd> | `Actor` | *required* | The actor to modify |
| <kbd>bonusIdOrPredicate</kbd> | `string\|Function` | *required* | Bonus ID string, or predicate `(bonus) => boolean` to match multiple |
| <kbd>skipEffectRemoval</kbd> | `boolean` | `false` | If true, keeps the linked active effects |

**Example:**
```js
// Remove by ID
await api.removeGlobalBonus(actor, "defense-net-abc123");

// Remove by predicate
await api.removeGlobalBonus(token.actor, b => b.context?.ownerTokenId === reactorToken.id);
```

</details>

---

<details>
<summary><b><code>getGlobalBonuses</code></b> · <b><code>getGlobalBonus</code></b></summary>

<br>

```js
const all    = api.getGlobalBonuses(actor)        // → Array<BonusData> (empty if falsy)
const single = api.getGlobalBonus(actor, bonusId)  // → BonusData | null
```

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>actor</kbd> | `Actor` | The actor to inspect |
| <kbd>bonusId</kbd> | `string` | The bonus ID (for `getGlobalBonus` only) |

</details>

---

<details>
<summary><b><code>addConstantBonus</code></b> <sup>async</sup> · <b><code>getConstantBonuses</code></b> · <b><code>removeConstantBonus</code></b> <sup>async</sup></summary>

<br>

```js
await api.addConstantBonus(actor, bonusData)              // same bonusData shape as addGlobalBonus
const bonuses = api.getConstantBonuses(actor)              // → Array<BonusData> (empty if falsy)
await api.removeConstantBonus(actor, bonusIdOrPredicate)   // string ID or predicate
```

Constant bonuses are permanent (stored in flags, not linked to an active effect). Auto-generates an `id` if not provided.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>actor</kbd> | `Actor` | The actor to modify/inspect |
| <kbd>bonusData</kbd> | `Object` | Same shape as `addGlobalBonus` |
| <kbd>bonusIdOrPredicate</kbd> | `string\|Function` | Bonus ID or predicate `(bonus) => boolean` |

</details>

---

### Flow State Data Injection

When within an active flow (like an attack, a check, etc.), the `triggerData` parameter contains a `flowState` object. You can use this state object to inject ephemeral bonuses or share arbitrary variables across triggers for the lifespan of that specific flow.

<details>
<summary><b><code>flowState.injectBonus</code></b> · <b><code>flowState.injectFlowExtraData</code></b> · <b><code>flowState.getFlowExtraData</code></b></summary>

<br>

```js
triggerData.flowState.injectBonus(bonus)            // add ephemeral bonus to current flow
triggerData.flowState.injectFlowExtraData(extraData) // merge into state.la_extraData
triggerData.flowState.getFlowExtraData()             // read la_extraData
```

- **`injectBonus`** — Adds an ephemeral bonus (e.g., an accuracy bonus). Applies to rolls during this flow and is discarded when the flow completes.
- **`injectFlowExtraData`** — Merges properties into `state.la_extraData`. Useful for passing variables between trigger phases (e.g., from `onHit` to `onDamage`).
- **`getFlowExtraData`** — Returns the `la_extraData` object attached to the current flow state.

</details>

---

### Immunity Queries

<details>
<summary><b><code>getImmunityBonuses</code></b> · <b><code>checkDamageResistances</code></b> · <b><code>applyDamageImmunities</code></b></summary>

<br>

```js
api.getImmunityBonuses(actor, subtype, state)    // → Array<object>
api.checkDamageResistances(actor, damageType)     // → Array<object>
api.applyDamageImmunities(actor, damages, state)  // → Array<object>
```

| Function | Description |
|:---------|:------------|
| `getImmunityBonuses` | Returns all immunity bonuses of the specified subtype (`"effect"`, `"damage"`, `"resistance"`, `"crit"`, `"hit"`, `"miss"`) for the actor. |
| `checkDamageResistances` | Returns all "resistance" subtype immunity bonuses matching the given damage type. |
| `applyDamageImmunities` | Takes an array of damage objects `{type, val}` and returns a new array where immune types are zeroed out. |

All accept an optional <kbd>state</kbd> (`Object`, default `null`) for conditional immunity evaluation.

> **Note:** `checkDamageResistances` is exported from `genericBonuses.js` but is not currently included in the `BonusesAPI` object.

</details>

---

<details>
<summary><b><code>hasCritImmunity</code></b> · <b><code>hasHitImmunity</code></b> · <b><code>hasMissImmunity</code></b> <sup>async</sup> → <code>boolean</code></summary>

<br>

```js
await api.hasCritImmunity(actor, attackerActor, state)
await api.hasHitImmunity(actor, attackerActor, state)
await api.hasMissImmunity(actor, attackerActor, state)
```

Returns `true` if the actor has any immunity bonuses of the corresponding subtype.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actor</kbd> | `Actor` | *required* | The actor to check |
| <kbd>attackerActor</kbd> | `Actor` | `null` | Optional attacker for conditional immunity checks |
| <kbd>state</kbd> | `Object` | `null` | Optional flow state |

</details>
