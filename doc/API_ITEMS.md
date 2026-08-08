# API - Item & Actor Data

[Back to API Reference](API_REFERENCE.md)

---

## Item & Actor Flags

<details>
<summary><b><code>addItemFlags</code></b> <sup>async</sup> → <code>Item</code> · <b><code>removeItemFlags</code></b> <sup>async</sup> → <code>Item</code> · <b><code>getItemFlags</code></b> → <code>any</code></summary>

<br>

```js
await api.addItemFlags(item, flags)            // set flags under 'lancer-automations'
await api.removeItemFlags(item, flags)         // unset the listed keys
api.getItemFlags(item, flagName?)              // read flags (specific key or all)
```

Routes through the GM via socket when the calling user does not own the item.

**Known flag keys:**

| Key | Type | Used by | Description |
|:----|:-----|:--------|:------------|
| <kbd>deployRange</kbd> | `number` | `placeDeployable` | Default placement range |
| <kbd>deployCount</kbd> | `number` | `placeDeployable` | Default number to place |

**Example:**
```js
await api.addItemFlags(myItem, { deployRange: 5, deployCount: 2 });
```

</details>

---

<details>
<summary><b><code>addActorFlags</code></b> <sup>async</sup> → <code>Actor</code> · <b><code>removeActorFlags</code></b> <sup>async</sup> → <code>Actor</code> · <b><code>getActorFlags</code></b> → <code>any</code></summary>

<br>

```js
await api.addActorFlags(actor, flags)          // set flags under 'lancer-automations'
await api.removeActorFlags(actor, flags)       // unset the listed keys
api.getActorFlags(actor, flagName?)            // read flags (specific key or all)
```

Routes through the GM via socket when the calling user does not own the actor.

**Known flag keys (deployable Mines, read by the `Mine Zone` general reaction):**

| Key | Type | Default | Description |
|:----|:-----|:--------|:------------|
| <kbd>mineDetectionRadius</kbd> | `number` | `1` | Aura radius in grid units. |
| <kbd>mineDetectionDisposition</kbd> | `"ALL"` \| `"FRIENDLY"` \| `"HOSTILE"` \| `"NEUTRAL"` | `"ALL"` | Which disposition triggers the detonation prompt. |
| <kbd>customMineDetection</kbd> | `boolean` | `false` | Skip the default `LA_MineZone` aura entirely; the per-LID handler installs its own detection. |

**Example:**
```js
// Custom mine: 3-space radius, hostile only.
await api.addActorFlags(mineActor, {
    mineDetectionRadius: 3,
    mineDetectionDisposition: "HOSTILE"
});
```

</details>

---

## Item Tags

<details>
<summary><b><code>addItemTag</code></b> <sup>async</sup> → <code>Item</code> · <b><code>removeItemTag</code></b> <sup>async</sup> → <code>Item</code></summary>

<br>

```js
await api.addItemTag(item, { id: "tg_heat_self", val: "2" })  // adds or updates tag
await api.removeItemTag(item, "tg_heat_self")                   // removes tag by ID
```

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>item</kbd> | `Item` | The item to modify |
| <kbd>tagData</kbd> | `Object` | Tag object (e.g. `{ id: "tg_heat_self", val: "2" }`) |
| <kbd>tagId</kbd> | `string` | Tag ID to remove |

</details>

---

## Activated Items

<details>
<summary><b><code>getActivatedItems</code></b> → <code>Array&lt;Item&gt;</code></summary>

<br>

```js
api.getActivatedItems(token)
```

Returns items currently marked as activated on a token (via `setItemAsActivated`). Checks `lancer-automations.activeStateData.active` on each item's flags.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token` | The token to inspect |

</details>

---

## Resource Management

<details>
<summary><b><code>setReaction</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.setReaction(actorOrToken, value)
```

Sets the reaction availability flag on an actor's action tracker.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>actorOrToken</kbd> | `Token\|Actor` | The token or actor to update |
| <kbd>value</kbd> | `boolean` | `true` = reaction available, `false` = reaction spent |

</details>

---

<details>
<summary><b><code>setItemResource</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.setItemResource(item, nb, counterIndex)
```

Sets a resource value on an item. Auto-detects the resource type.

Detection order:
1. **Talent** → `system.counters[counterIndex].value` (clamped to counter `min`/`max`)
2. **Uses** (`uses.max > 0`) → `system.uses.value` (clamped `0..max`)
3. **Loaded** → `system.loaded` (`Boolean(nb)`)
4. **Charged** → `system.charged` (`Boolean(nb)`)

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>item</kbd> | `Item` | *required* | The item document to update |
| <kbd>nb</kbd> | `number\|boolean` | *required* | Target value. For `loaded`/`charged`: truthy/falsy. For `uses`/counters: number (clamped to valid range). |
| <kbd>counterIndex</kbd> | `number` | `0` | For talent items: which counter to update. |

</details>

---

<details>
<summary><b><code>updateTokenSystem</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.updateTokenSystem(token, data)
```

Updates system data on a token's actor. Automatically routes through the GM socket if the current user doesn't own the actor.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token` | The token whose actor to update |
| <kbd>data</kbd> | `Object` | Update data object (e.g. `{ 'system.burn': 0, 'system.hp.value': 10 }`) |

**Example:**
```js
await api.updateTokenSystem(target, { 'system.burn': 0 });
```

</details>

---

## Extra Config

Per-item config controlling Lancer's automation of the item. First feature: opt out of auto-consuming specific resource types on activation. Stored at `item.flags['lancer-automations'].extraConfig`.

Resource type keys: `uses`, `loading`, `charged`, `perTurn`, `perRound`, `reserveUsed`.

<details>
<summary><b><code>setItemAutoConsumeDisabled</code></b> <sup>async</sup> → <code>string[]</code></summary>

<br>

```js
await api.setItemAutoConsumeDisabled(item, 'uses', true);
```

Toggle auto-consume opt-out for a single resource type. `true` = do NOT decrement on activation; `false` = default behavior.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>item</kbd> | `Item` | Owned Lancer item |
| <kbd>type</kbd> | `'uses'\|'loading'\|'charged'\|'perTurn'\|'perRound'\|'reserveUsed'` | Resource key |
| <kbd>disabled</kbd> | `boolean` | true = opt out |

Returns the updated opt-out array.

</details>

---

<details>
<summary><b><code>setItemAutoConsumeDisabledAll</code></b> <sup>async</sup> → <code>string[]</code></summary>

<br>

```js
await api.setItemAutoConsumeDisabledAll(item, true);  // disable every resource the item has
```

Mass-toggle: apply opt-out to every resource type the item has (or clear all).

</details>

---

<details>
<summary><b><code>isAutoConsumeDisabled</code></b> → <code>boolean</code></summary>

<br>

```js
if (api.isAutoConsumeDisabled(item, 'uses')) { ... }
```

</details>

---

<details>
<summary><b><code>getAutoConsumeDisabled</code></b> → <code>Set&lt;string&gt;</code></summary>

<br>

```js
const disabled = api.getAutoConsumeDisabled(item);  // Set of type keys
```

</details>

---

<details>
<summary><b><code>consumeItemResource</code></b> <sup>async</sup> → <code>number|boolean|null</code></summary>

<br>

```js
await api.consumeItemResource(item, 'uses', 2);   // uses -= 2 (clamped to 0)
await api.consumeItemResource(item, 'loading');   // loaded = false
```

Force a consume regardless of opt-out. Throws if the item does not have the resource type. Numeric fields clamp to `[0, max]`; booleans set to `false`.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>item</kbd> | `Item` | *required* | Owned Lancer item |
| <kbd>type</kbd> | `string` | *required* | Resource key |
| <kbd>amount</kbd> | `number` | `1` | Positive integer for numeric fields; ignored for booleans |

</details>

---

<details>
<summary><b><code>rechargeItemResource</code></b> <sup>async</sup> → <code>number|boolean|null</code></summary>

<br>

```js
await api.rechargeItemResource(item, 'uses', 3);  // uses += 3 (clamped to max)
await api.rechargeItemResource(item, 'charged'); // charged = true
```

Reverse of consume. Same signature, same validation.

</details>

---

<details>
<summary><b><code>configureItemExtraConfig</code></b> <sup>async</sup> → <code>object</code></summary>

<br>

```js
await api.configureItemExtraConfig(item, { autoConsumeDisabled: ['uses', 'loading'] });
```

Generic setter that shallow-merges a patch into the Extra Config flag. Prefer the explicit `setItemAutoConsumeDisabled*` helpers for the auto-consume feature; use this only for future Extra Config fields.

</details>

---

<details>
<summary><b><code>getExtraConfig</code></b> → <code>object|null</code></summary>

<br>

```js
const cfg = api.getExtraConfig(item);
```

Returns the full Extra Config flag object, or `null` if never configured.

</details>

### Consume Feedback

Any change to an item's consumable field (via API, Lancer flow, sheet click, TAH detail) triggers a floating text label above the actor's token + a `generic_stat` sound. To suppress for a specific update, pass `options.laConsumeFeedback = false` to `item.update(...)`.
