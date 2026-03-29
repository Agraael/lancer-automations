<h1>API — Effects & Bonuses</h1>

[Back to API Reference](API_REFERENCE.md)

<br>

<h2>Effect Management</h2>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>applyEffectsToTokens</code></h4> <sup>async</sup> → <code>Array&lt;Token&gt;</code></summary>

```js
await api.applyEffectsToTokens(options, extraOptions)
```

**`options` Object:**

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">tokens</b> | `Array<Token>` | *required* | Targets |
| <b style="color:#e0a050">effectNames</b> | `string\|Array` | *required* | `"prone"` or `{ name, icon, isCustom }` |
| <b style="color:#e0a050">note</b> | `string` | `undefined` | Flavor note |
| <b style="color:#e0a050">duration</b> | `Object` | `undefined` | `{ label, turns, rounds, overrideTurnOriginId }` — when `overrideTurnOriginId` is set, duration ticks down from that token's turn instead of the target's |
| <b style="color:#e0a050">checkEffectCallback</b> | `fn` | `null` | Duplicate check predicate |
| <b style="color:#e0a050">notify</b> | `bool\|obj` | `true` | Unified notification config |

**`extraOptions` Object:**
`{ stack, linkedBonusId, consumption, statDirect, changes, ...customFlags }`

Any additional key-value pairs in `extraOptions` (e.g. `suppressSourceId`, `suppressSourceName`) are stored verbatim inside `flags['lancer-automations']` on each created effect. These can later be used as removal filters via `extraFlags` in `removeEffectsByNameFromTokens`.

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>removeEffectsByNameFromTokens</code></h4> <sup>async</sup> → <code>Array&lt;Token&gt;</code></summary>

```js
await api.removeEffectsByNameFromTokens(options)
```

Finds all effects matching the given name(s) and removes them. This is a **find-by-name-and-delete-all-matches** operation — it removes every effect whose name matches, not a targeted removal by ID. To delete a specific known effect by ID, use `deleteEffect` instead.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">tokens</b> | `Array<Token>` | *required* | Tokens to remove from |
| <b style="color:#e0a050">effectNames</b> | `string\|Array` | *required* | Effect name(s) to match and remove |
| <b style="color:#e0a050">originId</b> | `string` | `null` | Only remove effects whose stored `originID` flag matches this value |
| <b style="color:#e0a050">extraFlags</b> | `Object` | `null` | Key/value pairs that must ALL match the effect's `flags['lancer-automations']` data |
| <b style="color:#e0a050">notify</b> | `bool\|Object` | `true` | Notification config |

> [!NOTE]
> `originId` and `extraFlags` are independent filters — both are applied when provided. Use `extraFlags` when the source identity was stored as a custom flag (not as `originID`).

**Example:**
```js
await api.removeEffectsByNameFromTokens({
    tokens: [targetToken],
    effectNames: ["Suppress", "impaired"],
    extraFlags: { suppressSourceId: reactorToken.id }
});
```

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>removeEffectsByName</code></h4> <sup>async</sup> → <code>void</code></summary>

```js
await api.removeEffectsByName(targetID, effectName, originID, extraFlags)
```

Removes effects from a single token by name. Lower-level than `removeEffectsByNameFromTokens` (which operates on arrays of tokens).

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">targetID</b> | `string` | *required* | The token ID to remove effects from |
| <b style="color:#e0a050">effectName</b> | `string` | *required* | Effect name to match and remove |
| <b style="color:#e0a050">originID</b> | `string` | `null` | Only remove effects whose stored `originID` flag matches |
| <b style="color:#e0a050">extraFlags</b> | `Object` | `null` | Key/value pairs that must ALL match the effect's `flags['lancer-automations']` data |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>deleteEffect</code></h4> → <code>void</code></summary>

```js
api.deleteEffect(token, effect)
```

Deletes a specific active effect by object or ID. Unlike `removeEffectsByNameFromTokens`, this targets one exact effect — no name matching, no side effects. Routes through the GM socket automatically for non-GM users.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">token</b> | `Token\|TokenDocument\|string` | The token (or its ID) that owns the effect |
| <b style="color:#e0a050">effect</b> | `ActiveEffect\|string` | The effect (or its ID) to delete |

**Example:**
```js
const effects = api.getAllEffects(target);
api.deleteEffect(target, effects[0]);
```

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>findEffectOnToken</code></h4> → <code>ActiveEffect | undefined</code></summary>

```js
api.findEffectOnToken(token, identifier)
```

Searches for an effect on a token by name or predicate function.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">token</b> | `Token\|TokenDocument` | The token to search |
| <b style="color:#e0a050">identifier</b> | `string\|Function` | Effect name (string) or predicate `(effect) => boolean` |

**Example — predicate search:**
```js
const effect = api.findEffectOnToken(target, e =>
    e.name === "Suppress" && e.flags?.['lancer-automations']?.suppressSourceId === reactorToken.id
);
```

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getAllEffects</code></h4> → <code>Array&lt;ActiveEffect&gt;</code></summary>

```js
api.getAllEffects(target)
```

Returns all active effects on the target, including unflagged player-added ones.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">target</b> | `Token\|TokenDocument\|Actor` | The target to inspect |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>consumeEffectCharge</code></h4> <sup>async</sup> → <code>boolean</code></summary>

```js
await api.consumeEffectCharge(effect)
```

Decrements the effect's stack counter by 1. If the counter reaches 0, the effect is deleted. Grouped effects (via `consumption.groupId`) share a counter and are all deleted together.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">effect</b> | `ActiveEffect` | The effect to consume a charge from |

Returns `true` if consumed, `false` if the effect has no consumption data.

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>triggerEffectImmunity</code></h4> <sup>async</sup> → <code>void</code></summary>

```js
await api.triggerEffectImmunity(token, effectNames, source, notify)
```

Removes the named effects from the token and announces immunity in chat.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">token</b> | `Token\|TokenDocument` | *required* | The immune token |
| <b style="color:#e0a050">effectNames</b> | `string\|Array<string>` | *required* | Effect name(s) to remove |
| <b style="color:#e0a050">source</b> | `Item\|string` | `""` | Source of immunity (item or text) |
| <b style="color:#e0a050">notify</b> | `boolean` | `true` | Post chat notification |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>checkEffectImmunities</code></h4> → <code>Array&lt;string&gt;</code></summary>

```js
api.checkEffectImmunities(actor, effectIdOrName, effect, state)
```

Returns an array of source names (e.g. `["Immunity Bonus", "Armor Plating"]`) if the actor is immune to the named effect.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">actor</b> | `Actor` | *required* | The actor to check |
| <b style="color:#e0a050">effectIdOrName</b> | `string` | *required* | Effect ID or name to check immunity for |
| <b style="color:#e0a050">effect</b> | `ActiveEffect` | `null` | Optional effect object for additional context |
| <b style="color:#e0a050">state</b> | `Object` | `null` | Optional flow state |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>deleteAllEffects</code></h4> <sup>async</sup> → <code>void</code> · <h4 style="display:inline"><code>executeEffectManager</code></h4> <sup>async</sup></summary>

```js
await api.deleteAllEffects(tokens)     // Removes ALL active effects from the provided tokens
await api.executeEffectManager(options) // Opens the Effect Manager UI
```

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">tokens</b> | `Array<Token\|TokenDocument>` | Tokens to clear |

</details>

<br>

<h2>Global & Constant Bonuses</h2>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>addGlobalBonus</code></h4> <sup>async</sup> → <code>string</code> (Bonus ID)</summary>

```js
const bonusId = await api.addGlobalBonus(actor, bonusData, options)
```

**`bonusData` Object:**

<details><summary>Core fields (all bonus types)</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <b style="color:#e0a050">id</b> | `string` | Optional custom ID |
| <b style="color:#e0a050">name</b> | `string` | Display name |
| <b style="color:#e0a050">type</b> | `string` | `"accuracy"`, `"difficulty"`, `"damage"`, `"stat"`, `"immunity"`, `"tag"`, `"range"`, `"multi"`, `"target_modifier"` |
| <b style="color:#e0a050">val</b> | `number\|string` | Value for stat, accuracy, difficulty, tag, or range bonuses |
| <b style="color:#e0a050">uses</b> | `number` | Stack count |
| <b style="color:#e0a050">rollTypes</b> | `Array` | `["attack"]`, `["check"]`, etc. |
| <b style="color:#e0a050">condition</b> | `string\|fn` | `(state, actor, data, context) => boolean` |
| <b style="color:#e0a050">itemLids</b> | `Array` | LID filters |
| <b style="color:#e0a050">applyTo</b> | `Array` | Token ID filters |

</details>

<details><summary>Immunity fields (type: "immunity")</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <b style="color:#e0a050">subtype</b> | `string` | `"effect"`, `"damage"`, `"resistance"`, `"crit"`, `"hit"`, `"miss"` |
| <b style="color:#e0a050">effects</b> | `Array` | Only for `subtype: "effect"`. List of effect/status names (e.g. `["Prone", "Immobilized"]`) |
| <b style="color:#e0a050">damageTypes</b> | `Array` | Only for `subtype: "damage"` or `"resistance"`. List of damage types (e.g. `["Energy", "Kinetic"]`) |

</details>

<details><summary>Target modifier fields (type: "target_modifier")</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <b style="color:#e0a050">subtype</b> | `string` | Attack: `"invisible"`, `"no_cover"`, `"soft_cover"`, `"hard_cover"`. Damage: `"ap"`, `"half_damage"`, `"paracausal"`, `"crit"`, `"hit"`, `"miss"` |

</details>

<details><summary>Tag fields (type: "tag")</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <b style="color:#e0a050">tagName</b> | `string` | Name of the custom tag (e.g. `"Inaccurate"`) |
| <b style="color:#e0a050">tagMode</b> | `string` | `"add"` or `"override"` |
| <b style="color:#e0a050">removeTag</b> | `boolean` | If true, negates the tag instead of adding it |

</details>

<details><summary>Range fields (type: "range")</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <b style="color:#e0a050">rangeType</b> | `string` | `"Range"`, `"Threat"`, `"Line"`, `"Blast"`, `"Burst"`, `"Cone"` |
| <b style="color:#e0a050">rangeMode</b> | `string` | `"add"` (default) or `"override"` |

</details>

<details><summary>Multi / Damage fields</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <b style="color:#e0a050">bonuses</b> | `Array` | Only for `type: "multi"`. Array of sub-bonus objects. |
| <b style="color:#e0a050">damage</b> | `Array` | Damage bonus: `[{ type, val }]` |
| <b style="color:#e0a050">stat</b> | `string` | Property path (e.g. `system.hp.max`) |

</details>

<br>

**`options` Object:**
`{ duration ("indefinite"|"end"|"start"), durationTurns, origin, consumption }`

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>removeGlobalBonus</code></h4> <sup>async</sup> → <code>void</code></summary>

```js
await api.removeGlobalBonus(actor, bonusIdOrPredicate, skipEffectRemoval)
```

Removes one or more global bonuses from an actor. Also deletes linked active effects unless `skipEffectRemoval` is true.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">actor</b> | `Actor` | *required* | The actor to modify |
| <b style="color:#e0a050">bonusIdOrPredicate</b> | `string\|Function` | *required* | Bonus ID string, or predicate `(bonus) => boolean` to match multiple |
| <b style="color:#e0a050">skipEffectRemoval</b> | `boolean` | `false` | If true, keeps the linked active effects |

**Example:**
```js
// Remove by ID
await api.removeGlobalBonus(actor, "defense-net-abc123");

// Remove by predicate
await api.removeGlobalBonus(token.actor, b => b.context?.ownerTokenId === reactorToken.id);
```

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getGlobalBonuses</code></h4> → <code>Array</code> · <h4 style="display:inline"><code>getGlobalBonus</code></h4> → <code>BonusData | null</code></summary>

```js
const all    = api.getGlobalBonuses(actor)        // all global bonuses (empty array if falsy)
const single = api.getGlobalBonus(actor, bonusId)  // single bonus by ID, or null
```

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">actor</b> | `Actor` | The actor to inspect |
| <b style="color:#e0a050">bonusId</b> | `string` | The bonus ID (for `getGlobalBonus` only) |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>addConstantBonus</code></h4> <sup>async</sup> · <h4 style="display:inline"><code>getConstantBonuses</code></h4> · <h4 style="display:inline"><code>removeConstantBonus</code></h4> <sup>async</sup></summary>

```js
await api.addConstantBonus(actor, bonusData)              // same bonusData shape as addGlobalBonus
const bonuses = api.getConstantBonuses(actor)              // all constant bonuses (empty array if falsy)
await api.removeConstantBonus(actor, bonusIdOrPredicate)   // string ID or predicate
```

Constant bonuses are permanent (stored in flags, not linked to an active effect). Auto-generates an `id` if not provided.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">actor</b> | `Actor` | The actor to modify/inspect |
| <b style="color:#e0a050">bonusData</b> | `Object` | Same shape as `addGlobalBonus` |
| <b style="color:#e0a050">bonusIdOrPredicate</b> | `string\|Function` | Bonus ID or predicate `(bonus) => boolean` |

</details>

<br>

<!-- ═══════════════════════════════════════════════════════════════ -->

<h3>Flow State Data Injection</h3>

When within an active flow (like an attack, a check, etc.), the `triggerData` parameter contains a `flowState` object. You can use this state object to inject ephemeral bonuses or share arbitrary variables across triggers for the lifespan of that specific flow.

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>flowState.injectBonus</code></h4> · <h4 style="display:inline"><code>flowState.injectFlowExtraData</code></h4> · <h4 style="display:inline"><code>flowState.getFlowExtraData</code></h4></summary>

```js
triggerData.flowState.injectBonus(bonus)            // add ephemeral bonus to current flow
triggerData.flowState.injectFlowExtraData(extraData) // merge into state.la_extraData
triggerData.flowState.getFlowExtraData()             // read la_extraData
```

- **`injectBonus`** — Adds an ephemeral bonus (e.g., an accuracy bonus). Applies to rolls during this flow and is discarded when the flow completes.
- **`injectFlowExtraData`** — Merges properties into `state.la_extraData`. Useful for passing variables between trigger phases (e.g., from `onHit` to `onDamage`).
- **`getFlowExtraData`** — Returns the `la_extraData` object attached to the current flow state.

</details>

<br>

<!-- ═══════════════════════════════════════════════════════════════ -->

<h3>Immunity Queries</h3>

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getImmunityBonuses</code></h4> · <h4 style="display:inline"><code>checkDamageResistances</code></h4> · <h4 style="display:inline"><code>applyDamageImmunities</code></h4></summary>

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

All accept an optional <b style="color:#e0a050">state</b> (`Object`, default `null`) for conditional immunity evaluation.

> [!NOTE]
> `checkDamageResistances` is exported from `genericBonuses.js` but is not currently included in the `BonusesAPI` object.

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>hasCritImmunity</code></h4> · <h4 style="display:inline"><code>hasHitImmunity</code></h4> · <h4 style="display:inline"><code>hasMissImmunity</code></h4> <sup>async</sup> → <code>boolean</code></summary>

```js
await api.hasCritImmunity(actor, attackerActor, state)
await api.hasHitImmunity(actor, attackerActor, state)
await api.hasMissImmunity(actor, attackerActor, state)
```

Returns `true` if the actor has any immunity bonuses of the corresponding subtype.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">actor</b> | `Actor` | *required* | The actor to check |
| <b style="color:#e0a050">attackerActor</b> | `Actor` | `null` | Optional attacker for conditional immunity checks |
| <b style="color:#e0a050">state</b> | `Object` | `null` | Optional flow state |

</details>
