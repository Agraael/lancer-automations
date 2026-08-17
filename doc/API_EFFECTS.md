# API - Effects & Bonuses

[Back to API Reference](API_REFERENCE.md)

---

## Effect Management

<details id="applyEffectsToTokens">
<summary><b><code>applyEffectsToTokens</code></b> <sup>async</sup> → <code>Array&lt;Token&gt;</code></summary>

<br>

```js
await api.applyEffectsToTokens(options, extraOptions)
```

**`options` Object:**

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
| <kbd>tokens</kbd> | `Array<Token>` | *required* | Targets |
| <kbd>effectNames</kbd> | `string\|{ name?: string; icon?: string; isCustom?: boolean }\|Array` | *required* | `"prone"` or `{ name, icon, isCustom }`. `isCustom: true` marks a Temporary-Custom-Statuses effect, not a built-in status |
| <kbd>note</kbd> | `string` | `undefined` | Flavor note |
| <kbd>duration</kbd> | `Object` | `undefined` | `{ label, turns, rounds, overrideTurnOriginId }` - `label` is a [duration label](API_REFERENCE.md#duration-labels). When `overrideTurnOriginId` is set, duration ticks down from that token's turn instead of the target's |
| <kbd>checkEffectCallback</kbd> | `(token: Token, effectData: object) => boolean` | `null` | Dup-check predicate `(token, effectData) => boolean`. Returning `true` blocks the apply with a warning |
| <kbd>notify</kbd> | `Object\|boolean` | `true` | Notification config `{ prefixText, source, whisper }` (or `true`) |

**`extraOptions` Object:**
`{ stack?: number, linkedBonusId?: string, consumption?: object, statDirect?: object, changes?: Array, ...customFlags }`

- `consumption` → [Concepts: Consumption](API_REFERENCE.md#consumption).
- `linkedBonusId`, `statDirect`, and any extra `...customFlags` → [Concepts: Effect flags](API_REFERENCE.md#effect-flags). Extra keys (e.g. `suppressSourceId`) are stored as-is in `flags['lancer-automations']` on each created effect and become removal filters via `extraFlags` in `removeEffectsByNameFromTokens`.

```js
await api.applyEffectsToTokens(
    { tokens: hitTokens, effectNames: ['lockon'] },
    { stack: 2 }
);
```

</details>

---

<details id="removeEffectsByNameFromTokens">
<summary><b><code>removeEffectsByNameFromTokens</code></b> <sup>async</sup> → <code>Array&lt;Token|TokenDocument&gt;</code></summary>

<br>

```js
await api.removeEffectsByNameFromTokens(options)
```

Removes every effect matching the given name(s). Use `deleteEffect` for one specific effect by ID.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
| <kbd>tokens</kbd> | `Array<Token\|TokenDocument>` | *required* | Tokens to remove from |
| <kbd>effectNames</kbd> | `string\|{ name?: string; icon?: string; isCustom?: boolean }\|Array` | *required* | Effect name(s) to match and remove |
| <kbd>originId</kbd> | `string` | `null` | Only remove effects whose stored `originID` flag matches this value |
| <kbd>extraFlags</kbd> | `Object` | `null` | Key/value pairs that must ALL match the effect's `flags['lancer-automations']` data |
| <kbd>notify</kbd> | `Object\|boolean` | `true` | Notification config |

`originId` and `extraFlags` are independent filters, both applied when provided.

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

<details id="applyMark">
<summary><b><code>applyMark</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code><br><b><code>findMarkedTokens</code></b> → <code>Token[]</code><br><b><code>clearMarks</code></b> <sup>async</sup> → <code>Promise&lt;Token[]&gt;</code></summary>

<br>

```js
await api.applyMark(sourceToken, targets, { effect, note, duration, flagKey })
api.findMarkedTokens(sourceToken, effectName, { flagKey })   // → Token[]
await api.clearMarks(sourceToken, effectName, { flagKey })   // → Token[] cleared
```

**Params:** <kbd>targets</kbd> `Token[]` · <kbd>effectName</kbd> `string` the mark's effect name

Source-stamped effect lifecycle: `applyMark` applies the effect with `{ [flagKey]: sourceToken.id }` stamped on it, `findMarkedTokens` scans the scene for tokens carrying it, `clearMarks` sweeps them all. The Suppress / Engineer's Mark / Sniper's Mark pattern.

See `findEffectFrom` and `findEffectsOnToken` for the lookup side.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
| <kbd>effect</kbd> | `string\|{ name, icon, isCustom }` | *required* | What to apply |
| <kbd>note</kbd> / <kbd>duration</kbd> | `string` / `Object` | `""` / indefinite | Forwarded to `applyEffectsToTokens` |
| <kbd>flagKey</kbd> | `string` | `'markSourceId'` | Stamp key. Pass a feature-specific one to keep marks independent |
| <kbd>extraOptions</kbd> | `Object` | `{}` | Extra flags stamped alongside |

```js
await api.applyMark(reactorToken, [target], { effect: 'Suppress', flagKey: 'suppressSourceId' });
const marked = api.findMarkedTokens(reactorToken, 'Suppress', { flagKey: 'suppressSourceId' });
await api.clearMarks(reactorToken, 'Suppress', { flagKey: 'suppressSourceId' });
```

</details>

---

<details id="removeEffectsByName">
<summary><b><code>removeEffectsByName</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.removeEffectsByName(targetID, effectName, originID, extraFlags)
```

Single-token version of `removeEffectsByNameFromTokens`.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>targetID</kbd> | `string` | *required* | The token ID to remove effects from |
| <kbd>effectName</kbd> | `string\|{ name: string }` | *required* | Effect name to match and remove |
| <kbd>originID</kbd> | `string` | `null` | Only remove effects whose stored `originID` flag matches |
| <kbd>extraFlags</kbd> | `Object` | `null` | Key/value pairs that must ALL match the effect's `flags['lancer-automations']` data |

```js
await api.removeEffectsByName(target.id, 'Suppress', reactorToken.id);
```

</details>

---

<details id="deleteEffect">
<summary><b><code>deleteEffect</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code></summary>

<br>

```js
await api.deleteEffect(token, effect)
```

Deletes one active effect by object or ID, no name matching. Routes through the GM socket automatically for non-GM users.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token\|TokenDocument\|string` | The token (or its ID) that owns the effect |
| <kbd>effect</kbd> | `ActiveEffect\|string` | The effect (or its ID) to delete |

**Example:**
```js
const effects = api.getAllEffects(target);
await api.deleteEffect(target, effects[0]);
```

</details>

---

<details id="findEffectOnToken">
<summary><b><code>findEffectOnToken</code></b> → <code>ActiveEffect | undefined</code></summary>

<br>

```js
api.findEffectOnToken(token, identifier)
```

Searches for an effect on a token by name or predicate function. The string form uses the house name rules (exact name, custom-status originalName, effect flags, loose includes, status id) and returns the first match. It delegates to `findEffectsOnToken`, which is the one to use for flag filters or all matches.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token\|TokenDocument` | The token to search |
| <kbd>identifier</kbd> | `string\|((e: ActiveEffect) => boolean)` | Effect name (string) or predicate `(effect) => boolean` |

**Example:**
```js
const cover = api.findEffectOnToken(target, "Soft Cover");
const mark = api.findEffectsOnToken(target, "Suppress", { extraFlags: { suppressSourceId: reactorToken.id } })[0];
```

</details>

---

<details id="findEffectsOnToken">
<summary><b><code>findEffectsOnToken</code></b> → <code>any[]</code></summary>

<br>

```js
api.findEffectsOnToken(token, effectName, options)
```

Every matching effect on one token, using the same loose name rules as `findEffectOnToken` (which delegates to this). Use it when you need flag filters or all matches rather than the first.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>token</kbd> | `Token\|TokenDocument` | *required* | The token to search |
| <kbd>effectName</kbd> | `string` | *required* | Name or status id |
| **inside `options`** | | | |
| <kbd>extraFlags</kbd> | `Object` | `{}` | Module flags that must match exactly |
| <kbd>hasFlags</kbd> | `string[]` | `[]` | Flag keys that must be present, any value |
| <kbd>excludeId</kbd> | `string` | `null` | Effect id to skip, for `onStatusRemoved` "is any other left?" checks |

```js
const others = api.findEffectsOnToken(token, 'Overshield', { excludeId: effect.id });
```

</details>

---

<details id="findEffectFrom">
<summary><b><code>findEffectFrom</code></b> → <code>ActiveEffect | undefined</code></summary>

<br>

```js
api.findEffectFrom(token, effectName, sourceToken)
```

The `originID` variant: the effect on `token` that `sourceToken` applied, matched on the `origin` stamp left by `addGlobalBonus` / `applyEffectsToTokens`. Use `findEffectsOnToken` with `extraFlags` instead when the source was stamped by `applyMark`'s `flagKey`.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token` | The token carrying the effect |
| <kbd>effectName</kbd> | `string` | Name or status id |
| <kbd>sourceToken</kbd> | `Token` | The token that applied it |

```js
const eff = api.findEffectFrom(target, 'Lock On', reactorToken);
```

</details>

---

<details id="hasStatus">
<summary><b><code>hasStatus</code></b> → <code>boolean</code></summary>

<br>

```js
api.hasStatus(tokenOrActor, ...statusIds)
```

True when any of the given status ids is active. Use this instead of reaching into `actor.statuses` by hand.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>tokenOrActor</kbd> | `Token\|TokenDocument\|Actor` | Whose statuses to read |
| <kbd>statusIds</kbd> | `...(string\|string[])` | Status ids, or arrays of them. Matches if any is present |

Takes status **ids** (`'cover_hard'`), not display names. For effects by name, or for flag filters, use [`findEffectOnToken`](#).

```js
if (api.hasStatus(target, 'prone', 'cover_hard', 'cover_soft'))
    return;
```

</details>

---

<details id="inDangerZone">
<summary><b><code>inDangerZone</code></b> → <code>boolean</code></summary>

<br>

```js
api.inDangerZone(tokenOrActor)
```

**Params:** <kbd>tokenOrActor</kbd> `Token|Actor`

True when heat is at or above half the heat cap. Same rule the `onHeatGain` trigger reports as `inDangerZone`.

```js
const difficulty = api.inDangerZone(target) ? 1 : 0;
```

</details>

---

<details id="untilEndOfTurn">
<summary><b><code>untilEndOfTurn</code></b><br><b><code>untilStartOfTurn</code></b> → <code>object</code><br><b><code>currentTurnKey</code></b> → <code>string|null</code></summary>

<br>

```js
api.untilEndOfTurn(token, turns = 1)      // → duration object
api.untilStartOfTurn(token, turns = 1)
api.currentTurnKey()                       // → "round:turn", null out of combat
```

`untilEndOfTurn` / `untilStartOfTurn` build the "until the end of *their* next turn" duration: the token becomes the turn origin, and the count is bumped by one when it is already that token's turn. Use these instead of hand-writing `{ label: 'end', turns: 1, rounds: 0 }`, which is off by one if applied on the target's own turn.

`currentTurnKey` stamps "the turn this happened on", so a later turn-end handler can tell whether it is looking at the same turn.

```js
await api.applyEffectsToTokens({ tokens: [target], effectNames: ['slowed'], duration: api.untilEndOfTurn(target) });
```

</details>

---

<details id="getAllEffects">
<summary><b><code>getAllEffects</code></b> → <code>Array&lt;ActiveEffect&gt;</code></summary>

<br>

```js
api.getAllEffects(target)
```

Returns all active effects on the target, including unflagged player-added ones.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>target</kbd> | `Token\|TokenDocument\|Actor` | The target to inspect |

```js
const names = api.getAllEffects(token).map(e => e.name);
```

</details>

---

<details id="consumeEffectCharge">
<summary><b><code>consumeEffectCharge</code></b> <sup>async</sup> → <code>boolean</code></summary>

<br>

```js
await api.consumeEffectCharge(effect)
```

Decrements the effect's stack counter by 1. If the counter reaches 0, the effect is deleted. Grouped effects (via [`consumption`](API_REFERENCE.md#consumption)`.groupId`) share a counter and are all deleted together.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>effect</kbd> | `ActiveEffect` | The effect to consume a charge from |

Returns `true` if consumed, `false` if the effect has no consumption data.

```js
const eff = api.findEffectOnToken(token, 'Shield Charges');
if (eff) await api.consumeEffectCharge(eff);
```

</details>

---

<details id="triggerEffectImmunity">
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

```js
await api.triggerEffectImmunity(target, ['impaired'], reactorToken, true);
```

</details>

---

<details id="checkEffectImmunities">
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

```js
if (api.checkEffectImmunities(target.actor, 'prone')) return;
```

</details>

---

<details id="deleteAllEffects">
<summary><b><code>deleteAllEffects</code></b> → <code>Promise&lt;void&gt;</code><br><b><code>executeEffectManager</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code></summary>

<br>

```js
await api.deleteAllEffects(tokens)     // Removes ALL active effects from the provided tokens
await api.executeEffectManager(options) // Opens the Effect Manager UI
```

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>tokens</kbd> | `Array<Token\|TokenDocument>` | Tokens to clear (`deleteAllEffects`) |

`executeEffectManager(options)` - `options`: `{ item?, actor?, forcePrototype? }`, pre-selecting the target (an item's prototype, an actor's active token, or the actor prototype when `forcePrototype`).

```js
await api.deleteAllEffects([token]);
```

</details>

---

## Global & Constant Bonuses

<details id="addGlobalBonus">
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
| <kbd>consumeOnUsage</kbd> | `boolean` | Burn 1 use only when the bonus actually applies (still checked at roll time / immunity blocked / reroll accepted). Supported: accuracy, difficulty, damage, target_modifier, reroll, immunity (effect/crit/hit/miss/damage/provoke/terrain). Default true, except immunity which defaults false. The `Auto-consume on:` triggers burn regardless and take precedence. |
| <kbd>rollTypes</kbd> | `Array` | `["attack"]`, `["check"]`, etc. |
| <kbd>condition</kbd> | `string\|fn` | `(state, actor, data, context) => boolean`. **Per-bonus** gate - if false, the whole bonus is skipped. |
| <kbd>itemLids</kbd> | `Array` | LID filters |
| <kbd>applyTo</kbd> | `Array` | Token ID filters. Static - set at bonus creation. For dynamic per-target filters on `target_modifier`, see `applyToCondition` below. |
| <kbd>tier</kbd> | `1\|2\|3` | Gate to an NPC owner tier. Unset = any. Non-NPC owners ignore it |

</details>

<details>
<summary>Immunity fields (type: "immunity")</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <kbd>subtype</kbd> | `string` | One of the [immunity subtypes](API_REFERENCE.md#immunity-subtypes) |
| <kbd>effects</kbd> | `Array` | Only for `subtype: "effect"`. List of effect/status names (e.g. `["Prone", "Immobilized"]`) |
| <kbd>damageTypes</kbd> | `Array` | Only for `subtype: "damage"` or `"resistance"`. List of damage types (e.g. `["Energy", "Kinetic"]`) |

`"provoke"` acts like permanent DISENGAGE. No extra fields required.

</details>

<details>
<summary>Target modifier fields (type: "target_modifier")</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <kbd>subtype</kbd> | `string` | Attack: `"invisible"`, `"no_invisible"`, `"no_cover"`, `"soft_cover"`, `"hard_cover"`. Damage: `"ap"`, `"half_damage"`, `"paracausal"`, `"crit"`, `"hit"`, `"miss"` |
| <kbd>applyToCondition</kbd> | `string\|fn` | **Per-target** gate (complements `applyTo` and `condition`). Lambda `(target, state, reactorToken) => boolean` evaluated once per target during the attack / damage / toggle pass. Must be synchronous. Serialized via `@@fn:` - survives reloads. |

`"no_invisible"` forces `plugins.invisibility.data = 0` on the target, bypassing `"invisible"`.

**Example - ignore invisibility only within range 3:**
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
| <kbd>rangeMode</kbd> | `string` | `"add"` (default, accepts negative val), `"override"` (set existing or create), or `"change"` (replace all ranges with a single entry) |

</details>

<details>
<summary>Reroll fields (type: "reroll")</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <kbd>subtype</kbd> | `string` | `"retry"` (default), `"highest"`, `"lowest"`, or `"choose"`. See resolution table below. |
| <kbd>rollTypes</kbd> | `Array<string>` | `"attackRoll"`, `"techAttackRoll"`, `"damageRoll"`, `"skillRoll"`, `"structureRoll"`, `"stressRoll"`. Empty = all. |

Offered via a choice card before `onRoll` fires. Consumed only on **Use** (Keep leaves the charge).

| Subtype | Resolution after the alt roll runs |
|:--------|:-----------------------------------|
| `"retry"` | Replace original with the alt (current default behavior). |
| `"highest"` | Auto-keep `max(originalTotal, altTotal)`. Stacking gives best-of-N+1. |
| `"lowest"`  | Auto-keep `min(originalTotal, altTotal)`. Stacking gives worst-of-N+1. |
| `"choose"`  | Second card prompts `Original (X)` / `Alt (Y)` and the user picks. |

**Stacking:** when an actor has multiple `reroll` bonuses matching a roll, they fire sequentially, each operating on the *current* total. Candidates are sorted by subtype priority (`retry` → `highest`/`lowest` → `choose`). Damage rolls deep-snapshot `damage_results`/`reliable_results`/`targets`, so "keep original" restores the full breakdown.

</details>

<details>
<summary>Multi / Damage fields</summary>

| Property | Type | Description |
|:---------|:-----|:------------|
| <kbd>bonuses</kbd> | `Array` | Only for `type: "multi"`. Array of sub-bonus objects. |
| <kbd>damage</kbd> | `Array` | Damage bonus. Shape depends on `damageMode`: `[{ type, val }]` for `add`/`add_base`/`replace`, `[{ from, to }]` for `change_type` (use `from: "all"` as a fallback catch-all, and specific `from` types win over `"all"`). |
| <kbd>damageMode</kbd> | `string` | `"add"` (default, adds bonus damage rows in the Bonus Damage section), `"add_base"` (appends extra damage rows to the weapon's Base Damage), `"replace"` (weapon's base damage is fully replaced), `"change_type"` (weapon's damage values kept, types remapped). All modes except `add` are actor-wide only. `applyTo` is stripped on save for those. |
| <kbd>stat</kbd> | `string` | Property path (e.g. `system.hp.max`) |
| <kbd>statMode</kbd> | `string` | `"add"` (default, adds `val` to the current stat) or `"replace"` (sets the stat to `val`). Reversal preserves any damage / healing taken during the effect (delta-based, see [`statDirect`](API_REFERENCE.md#effect-flags)). |

</details>

<br>

**`options` Object:**
`{ duration?: string, durationTurns?: number, origin?: Token|TokenDocument|string, consumption?: ConsumptionConfig }`

`duration` is a [duration label](API_REFERENCE.md#duration-labels). `consumption` is a [Consumption](API_REFERENCE.md#consumption) config.

`durationTurns` counts origin turns until the effect ends:
- `0`: next matching trigger. If applied during origin's own turn with `duration: "end"`, ends at end of that same turn. With `duration: "start"`, it ends at start of the next turn. Off-combat / off-origin's-turn, `0` clamps to `1`.
- `1`: one full origin turn (default). With `duration: "end"` applied during origin's own turn, ends at end of origin's *next* turn.
- `n ≥ 2`: `n` origin turns.

</details>

---

<details id="removeGlobalBonus">
<summary><b><code>removeGlobalBonus</code></b> <sup>async</sup> → <code>boolean</code></summary>

<br>

```js
await api.removeGlobalBonus(actor, bonusIdOrPredicate, skipEffectRemoval)
```

Removes one or more global bonuses from an actor. Also deletes linked active effects unless `skipEffectRemoval` is true.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actor</kbd> | `Actor` | *required* | The actor to modify |
| <kbd>bonusIdOrPredicate</kbd> | `string\|((bonus) => boolean)` | *required* | Bonus ID string, or predicate `(bonus) => boolean` to match multiple |
| <kbd>skipEffectRemoval</kbd> | `boolean` | `false` | If true, keeps the linked active effects |

**Example:**
```js
await api.removeGlobalBonus(actor, "defense-net-abc123");

await api.removeGlobalBonus(token.actor, b => b.context?.ownerTokenId === reactorToken.id);
```

</details>

---

<details id="getGlobalBonuses">
<summary><b><code>getGlobalBonuses</code></b> → <code>any[]</code><br><b><code>getGlobalBonus</code></b> → <code>object|null</code></summary>

<br>

```js
const all    = api.getGlobalBonuses(actor)        // → Array<BonusData> (empty if falsy)
const single = api.getGlobalBonus(actor, bonusId)  // → BonusData | null
```

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>actor</kbd> | `Actor` | The actor to inspect |
| <kbd>bonusId</kbd> | `string` | The bonus ID (for `getGlobalBonus` only) |

```js
const bonus = api.getGlobalBonus(actor, 'lightning-reflexes');
```

</details>

---

<details id="addConstantBonus">
<summary><b><code>addConstantBonus</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code><br><b><code>getConstantBonuses</code></b> → <code>any[]</code><br><b><code>removeConstantBonus</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code></summary>

<br>

```js
await api.addConstantBonus(actor, bonusData)              // same bonusData shape as addGlobalBonus
const bonuses = api.getConstantBonuses(actor)              // → Array<BonusData> (empty if falsy)
await api.removeConstantBonus(actor, bonusIdOrPredicate)   // string ID or predicate
```

Constant bonuses are permanent (stored in flags, not linked to an active effect). Auto-generates an `id` if not provided.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>target</kbd> / <kbd>actor</kbd> | `Actor` | The actor to modify/inspect |
| <kbd>bonusData</kbd> | `Object` | Same shape as `addGlobalBonus` |
| <kbd>bonusIdOrPredicate</kbd> | `string\|((bonus) => boolean)` | Bonus ID or predicate `(bonus) => boolean` |

> When the target is an **item** or a **prototype actor**, use `linkBonusToItem` / `linkBonusToActor` instead.

```js
await api.addConstantBonus(actor, { name: 'Core Power', type: 'accuracy', val: 1, rollTypes: ['attack'] });
await api.removeConstantBonus(actor, (b) => b.name === 'Core Power');
```

</details>

---

## Attach to items and prototype actors

Statuses and bonuses can be attached directly to an **item** or a **prototype actor** instead of a token. The entry lives on the source doc, and applies to the token's actor on item-add, token-spawn, or re-enable. It's cleaned up on remove / destroy / disable. Charges persist across the cycle.

<details id="linkEffectToItem">
<summary><b><code>linkEffectToItem</code></b><br><b><code>linkEffectToActor</code></b><br><b><code>ensureLinkedEffect</code></b> <sup>async</sup> → <code>Array</code></summary>

<br>

```js
await api.linkEffectToItem({ items, effectNames, note, duration }, extraOptions)
await api.linkEffectToActor({ actors, effectNames, note, duration }, extraOptions)
await api.ensureLinkedEffect({ items, effectNames, note, duration }, extraOptions)  // idempotent
```

Attaches a status to each source doc. Fires immediately on any active tokens.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
| <kbd>items</kbd> / <kbd>actors</kbd> | `Array` | *required* | Source docs |
| <kbd>effectNames</kbd> | `string\|Object\|Array` | *required* | Same shape as `applyEffectsToTokens` |
| <kbd>note</kbd> | `string` | `""` | Flavor note |
| <kbd>duration</kbd> | `Object` | `{ label: 'permanent' }` | `{ label, turns?, rounds? }` |

`extraOptions` keys are stored on the source and copied to every effect that comes from it. `extraOptions.tier` (1-3) gates materialization to NPC owners of that tier.

`ensureLinkedEffect` is `linkEffectToItem` that skips effects the item already carries as a template (match = effect name + every `extraOptions` flag). The onInit way to link: no hand-written guard needed.

```js
await api.ensureLinkedEffect({ items: [item], effectNames: ['resistance_kinetic'] });
```

</details>

---

<details id="unlinkEffectFromItem">
<summary><b><code>unlinkEffectFromItem</code></b><br><b><code>unlinkEffectFromActor</code></b> <sup>async</sup> → <code>Array</code></summary>

<br>

```js
await api.unlinkEffectFromItem({ items, effectName, extraFlags })
await api.unlinkEffectFromActor({ actors, effectName, extraFlags })
```

Removes the entry from the source doc. Every effect that came from it is removed from active tokens too.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
| <kbd>items</kbd> / <kbd>actors</kbd> | `Item[]` / `Actor[]` | `[]` | Source docs to unlink from |
| <kbd>effectName</kbd> | `string` | `""` | Name of the linked effect |
| <kbd>extraFlags</kbd> | `Object` | `null` | Must match the linked entry's flags |

```js
await api.unlinkEffectFromItem({ items: [item], effectName: 'resistance_kinetic' });
```

</details>

---

<details id="linkBonusToItem">
<summary><b><code>linkBonusToItem</code></b><br><b><code>linkBonusToActor</code></b><br><b><code>ensureLinkedBonus</code></b> <sup>async</sup> → <code>Array</code></summary>

<br>

```js
await api.linkBonusToItem({ items, bonusData, addOptions }, extraOptions)
await api.linkBonusToActor({ actors, bonusData, addOptions }, extraOptions)
await api.ensureLinkedBonus({ items, bonusData, addOptions }, extraOptions)  // idempotent, needs bonusData.id
```

Attaches a bonus to each source doc. Applies immediately on active tokens.

The `duration` in `addOptions` decides how it shows up:

- `'constant'`: passive, invisible, no token icon (same as `addConstantBonus`).
- anything else (`'permanent'`, `'indefinite'`, `'end'`, `'start'`, `'round'`): full bonus with icon, uses / consumption, and turn tracking (same as `addGlobalBonus`).

`bonusData` and `addOptions` shapes match `addGlobalBonus`.

`ensureLinkedBonus` is `linkBonusToItem` that skips items already carrying a template with the same `bonusData.id`. The onInit way to link a bonus.

```js
await api.ensureLinkedBonus({ items: [item], bonusData: { id: 'smart-rounds', type: 'accuracy', val: 1, rollTypes: ['attack'] } });
```

</details>

---

<details id="unlinkBonusFromItem">
<summary><b><code>unlinkBonusFromItem</code></b><br><b><code>unlinkBonusFromActor</code></b> <sup>async</sup> → <code>Array</code></summary>

<br>

```js
await api.unlinkBonusFromItem({ items, templateId })
await api.unlinkBonusFromActor({ actors, templateId })
```

Removes the entry from the source doc. Every bonus that came from it is removed from active tokens too. Charge counts are saved back to the source first, so a re-link picks them back up.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
| <kbd>items</kbd> / <kbd>actors</kbd> | `Item[]` / `Actor[]` | `[]` | Source docs to unlink from |
| <kbd>templateId</kbd> | `string` | *required* | The linked bonus's id |

```js
await api.unlinkBonusFromItem({ items: [item], templateId: 'smart-rounds' });
```

</details>

---

<details id="getLinkedEffects">
<summary><b><code>getLinkedEffects</code></b> → <code>any[]</code><br><b><code>getLinkedBonuses</code></b> → <code>any[]</code></summary>

<br>

```js
api.getLinkedEffects(source)   // → ActiveEffect[]  status templates on Item or Actor
api.getLinkedBonuses(source)   // → Object[]        bonus templates on Item or Actor
```

**Params:** <kbd>source</kbd> `Item|Actor`

Read-side helpers, symmetric with `getConstantBonuses` / `getGlobalBonuses`. Returns the LINKED entries only (not merged with runtime state on the actor).

```js
const hasTemplate = api.getLinkedBonuses(item).some(t => t.id === 'smart-rounds');
```

</details>

---

<details>
<summary>Manual apply / cleanup helpers <sup>all async</sup></summary>

<br>

```js
await api.applyItemTemplatesToTokens(item, tokens)         // apply the item's statuses to given tokens
await api.applyActorTemplatesToTokens(actor, tokens)       // apply the actor's statuses to given tokens
await api.applyItemBonusTemplatesToTokens(item, tokens)    // apply the item's bonuses
await api.applyActorBonusTemplatesToTokens(actor, tokens)  // apply the actor's bonuses
await api.cleanupItemBonusesFromActor(item, actor)          // remove bonuses that came from this item
await api.cleanupActorBonusesFromTokens(actor)              // remove bonuses that came from this actor
```

The lifecycle hooks call these for you. Only reach for them if you need to force a pass from custom code. All safe to call repeatedly - they skip anything already applied.

Args: `item`/`actor` source doc. The `apply*` helpers also take `tokens` (`Array<Token\|TokenDocument>`). `cleanupItemBonusesFromActor(item, actor)` and `cleanupActorBonusesFromTokens(actor)`.

</details>

---

### Flow State Data Injection

During an active flow (attack, check, etc.), `triggerData` contains a `flowState` object. Inject ephemeral bonuses or share variables across triggers for the flow's lifespan.

<details>
<summary><b><code>flowState.injectBonus</code></b><br><b><code>flowState.injectFlowExtraData</code></b><br><b><code>flowState.getFlowExtraData</code></b></summary>

<br>

```js
triggerData.flowState.injectBonus(bonus)            // add ephemeral bonus to current flow
triggerData.flowState.injectFlowExtraData(extraData) // merge into state.la_extraData
triggerData.flowState.getFlowExtraData()             // read la_extraData
```

- **`injectBonus`** - ephemeral bonus (e.g. an accuracy bonus) applied to this flow's rolls, discarded when the flow completes.
- **`injectFlowExtraData`** - Merges properties into `state.la_extraData`, passing variables between trigger phases (e.g. from `onHit` to `onDamage`).
- **`getFlowExtraData`** - Returns the `la_extraData` object attached to the current flow state.

</details>

---

<details id="injectBonusToFlowState">
<summary><b><code>injectBonusToFlowState</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code></summary>

<br>

```js
await api.injectBonusToFlowState(state, bonus)
```

The standalone form of `flowState.injectBonus`, for when you hold the flow state rather than a `triggerData`. Pushes the bonus onto `state.la_extraData.flow_bonus`, generating an `id` if you didn't supply one. Does nothing if `state` is missing.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>state</kbd> | `Object` | The flow state, e.g. `triggerData.flowState` |
| <kbd>bonus</kbd> | `Object` | Same shape as `addGlobalBonus`. Gets an `id` if absent |

```js
await api.injectBonusToFlowState(triggerData.flowState, {
    id: `lightning-reflexes-${reactorToken.id}`,
    name: 'Lightning Reflexes',
    type: 'immunity',
    subtype: 'hit'
});
```

</details>

---

### Immunity Queries

<details id="getImmunityBonuses">
<summary><b><code>getImmunityBonuses</code></b> → <code>any[]</code><br><b><code>checkDamageResistances</code></b> → <code>any[]</code><br><b><code>applyDamageImmunities</code></b> → <code>Array&lt;{ type: string; val: any }&gt;</code></summary>

<br>

```js
api.getImmunityBonuses(actor, subtype, state)    // → Array<object>
api.checkDamageResistances(actor, damageType)     // → Array<object>
api.applyDamageImmunities(actor, damages, state)  // → Array<object>
```

**Params:** <kbd>actor</kbd> `Actor` · <kbd>subtype</kbd> `string` immunity subtype · <kbd>damageType</kbd> `string` · <kbd>damages</kbd> `Array<{type, val}>`

| Function | Description |
|:---------|:------------|
| `getImmunityBonuses` | Returns all immunity bonuses of the specified [subtype](API_REFERENCE.md#immunity-subtypes) for the actor. |
| `checkDamageResistances` | Returns all "resistance" subtype immunity bonuses matching the given damage type. |
| `applyDamageImmunities` | Takes an array of damage objects `{type, val}` and returns a new array where immune types are zeroed out. |

`getImmunityBonuses` and `applyDamageImmunities` accept an optional <kbd>state</kbd> (`Object`, default `null`) for conditional immunity evaluation.

```js
const resist = api.checkDamageResistances(target.actor, 'Energy');
```

</details>

---

<details id="hasCritImmunity">
<summary><b><code>hasCritImmunity</code></b><br><b><code>hasHitImmunity</code></b><br><b><code>hasMissImmunity</code></b> <sup>async</sup> → <code>boolean</code></summary>

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

```js
if (await api.hasHitImmunity(target.actor, attackerActor, triggerData.flowState)) return;
```

</details>
