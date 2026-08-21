# API - Item & Actor Data

[Back to API Reference](API_REFERENCE.md)

---

## Item & Actor Flags

<details id="addItemFlags">
<summary><b><code>addItemFlags</code></b> <sup>async</sup> → <code>Item</code><br><b><code>removeItemFlags</code></b> <sup>async</sup> → <code>Item</code><br><b><code>getItemFlags</code></b> → <code>any</code></summary>

<br>

```js
await api.addItemFlags(item, flags)            // set flags under 'lancer-automations'
await api.removeItemFlags(item, flags)         // unset the listed keys
api.getItemFlags(item, flagName?)              // read flags (specific key or all)
```

**Params:** <kbd>item</kbd> `Item` · <kbd>flags</kbd> `Object` key/value pairs · <kbd>flagName</kbd> `string` optional single key

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

<details id="addTokenFlags">
<summary><b><code>addTokenFlags</code></b> <sup>async</sup> → <code>TokenDocument</code><br><b><code>getTokenFlags</code></b> → <code>any</code></summary>

<br>

```js
await api.addTokenFlags(tokenOrDoc, flags)
api.getTokenFlags(tokenOrDoc, flagName?)
```

The token-document counterpart to `addItemFlags` / `getItemFlags`. Routes through the GM via socket when the calling user does not own the token.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>tokenOrDoc</kbd> | `Token\|TokenDocument` | *required* | Token to read or stamp |
| <kbd>flags</kbd> | `Object` | *required* | Key/value pairs set under `lancer-automations` |
| <kbd>flagName</kbd> | `string` | `null` | Read one key. Omit for the whole namespace object |

```js
await api.addTokenFlags(token, { mineArmed: true });
const armed = api.getTokenFlags(token, 'mineArmed');
```

</details>

<details id="addActorFlags">
<summary><b><code>addActorFlags</code></b> <sup>async</sup> → <code>Actor</code><br><b><code>removeActorFlags</code></b> <sup>async</sup> → <code>Actor</code><br><b><code>getActorFlags</code></b> → <code>any</code></summary>

<br>

```js
await api.addActorFlags(actor, flags)          // set flags under 'lancer-automations'
await api.removeActorFlags(actor, flags)       // unset the listed keys
api.getActorFlags(actor, flagName?)            // read flags (specific key or all)
```

**Params:** <kbd>actor</kbd> `Actor` · <kbd>flags</kbd> `Object` key/value pairs · <kbd>flagName</kbd> `string` optional single key

Routes through the GM via socket when the calling user does not own the actor.

**Known flag keys (deployable Mines, read by the `Mine Zone` general reaction):**

| Key | Type | Default | Description |
|:----|:-----|:--------|:------------|
| <kbd>mineDetectionRadius</kbd> | `number` | `1` | Aura radius in grid units. |
| <kbd>mineDetectionDisposition</kbd> | `"ALL"` \| `"FRIENDLY"` \| `"HOSTILE"` \| `"NEUTRAL"` | `"ALL"` | Which disposition triggers the detonation prompt. |
| <kbd>customMineDetection</kbd> | `boolean` | `false` | Skip the default `LA_MineZone` aura entirely. The per-LID handler installs its own detection. |

**Example:**
```js
await api.addActorFlags(mineActor, {
    mineDetectionRadius: 3,
    mineDetectionDisposition: "HOSTILE"
});
```

</details>

---

## Item Tags

<details id="addItemTag">
<summary><b><code>addItemTag</code></b> <sup>async</sup> → <code>Item</code><br><b><code>removeItemTag</code></b> <sup>async</sup> → <code>Item</code></summary>

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

<details id="setItemAsActivated">
<summary><b><code>setItemAsActivated</code></b> <sup>async</sup> → <code>Promise&lt;Item&gt;</code></summary>

<br>

```js
await api.setItemAsActivated(item, token, endAction, endActionDescription)
```

Marks an item as activated, so it shows as active in the HUD and appears in `getActivatedItems`. `endAction` is the action the player spends to end it, surfaced on the end-activation entry. Close it with `endItemActivation`.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>item</kbd> | `Item` | *required* | The item to mark |
| <kbd>token</kbd> | `Token` | *required* | Owner of the item |
| <kbd>endAction</kbd> | `string` | *required* | Action spent to end it, e.g. `"Quick"` / `"Full"` |
| <kbd>endActionDescription</kbd> | `string` | `""` | Text shown when ending the activation |

```js
await api.setItemAsActivated(item, token, 'Quick', 'Deactivate the shield.');
```

</details>

<details id="getActivatedItems">
<summary><b><code>getActivatedItems</code></b> → <code>Array&lt;Item&gt;</code></summary>

<br>

```js
api.getActivatedItems(token)
```

Returns items currently marked as activated on a token (via `setItemAsActivated`). Checks `lancer-automations.activeStateData.active` on each item's flags.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token` | The token to inspect |

```js
const active = api.getActivatedItems(token);
if (active.some(i => i.name === 'Aegis Shield Generator')) return false;
```

</details>

<details id="endItemActivation">
<summary><b><code>endItemActivation</code></b> <sup>async</sup> → <code>Promise&lt;boolean&gt;</code></summary>

<br>

```js
await api.endItemActivation(item, token)
```

Ends an activation started by `setItemAsActivated`: clears the activated flags and posts the end-of-activation chat message through `SimpleActivationFlow`. Resolves whether the flow completed.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>item</kbd> | `Item` | The activated item |
| <kbd>token</kbd> | `Token` | The token the flow runs for |

```js
await api.endItemActivation(item, token);
```

</details>

<details id="openEndActivationMenu">
<summary><b><code>openEndActivationMenu</code></b> <sup>async</sup> → <code>Promise&lt;Item | null&gt;</code></summary>

<br>

```js
await api.openEndActivationMenu(token)
```

Prompt listing the token's activated items; the picked one is ended via `endItemActivation`. Resolves the ended item, or `null` on cancel.

**Params:** <kbd>token</kbd> `Token` holder of the activated items

</details>

<details id="destroyItem">
<summary><b><code>destroyItem</code></b> <sup>async</sup> → <code>Promise&lt;Item | null&gt;</code><br><b><code>disableItem</code></b> <sup>async</sup> → <code>Promise&lt;Item | null&gt;</code><br><b><code>restoreItem</code></b> <sup>async</sup> → <code>Promise&lt;Item | null&gt;</code></summary>

<br>

```js
await api.destroyItem(item)   // system.destroyed = true
await api.disableItem(item)   // system.disabled = true
await api.restoreItem(item)   // clears both
```

**Params:** <kbd>item</kbd> `Item`

Destroyed/disabled items are skipped by the reaction engine and the action-lock system, and Lancer greys them on the sheet. Returns the item, or `null` if the argument is not an Item.

```js
await api.disableItem(weapon);
await api.restoreItem(weapon);
```

</details>

---

## Resource Management

<details id="setReaction">
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

```js
await api.setReaction(reactorToken, false);
```

</details>

<details id="hasReactionAvailable">
<summary><b><code>hasReactionAvailable</code></b> → <code>boolean</code></summary>

<br>

```js
api.hasReactionAvailable(tokenOrActor)
```

Reads the reaction flag on the actor's action tracker. Out of combat (no combatant for this actor) it is always `true`.

**Params:** <kbd>tokenOrActor</kbd> `Token|Actor`

```js
if (!api.hasReactionAvailable(reactorToken)) return false;
```

</details>

<details id="setItemResource">
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

```js
await api.setItemResource(talentItem, 2, 0);
```

</details>

<details id="updateTokenSystem">
<summary><b><code>updateTokenSystem</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.updateTokenSystem(token, data)
```

Updates system data on a token's actor. Routes through the GM via socket when the calling user does not own the actor.

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

Per-item config controlling Lancer's automation of the item. Currently: opt out of auto-consuming specific resource types on activation. Stored at `item.flags['lancer-automations'].extraConfig`.

Resource type keys: `uses`, `loading`, `charged`, `perTurn`, `perRound`, `reserveUsed`.

<details id="setItemAutoConsumeDisabled">
<summary><b><code>setItemAutoConsumeDisabled</code></b> <sup>async</sup> → <code>string[]</code></summary>

<br>

```js
await api.setItemAutoConsumeDisabled(item, 'uses', true);
```

Toggle auto-consume opt-out for a single resource type. `true` = do NOT decrement on activation. `false` = default behavior.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>item</kbd> | `Item` | Owned Lancer item |
| <kbd>type</kbd> | `'uses'\|'loading'\|'charged'\|'perTurn'\|'perRound'\|'reserveUsed'` | Resource key |
| <kbd>disabled</kbd> | `boolean` | true = opt out |

Returns the updated opt-out array.

</details>

<details id="setItemAutoConsumeDisabledAll">
<summary><b><code>setItemAutoConsumeDisabledAll</code></b> <sup>async</sup> → <code>string[]</code></summary>

<br>

```js
await api.setItemAutoConsumeDisabledAll(item, true);  // disable every resource the item has
```

**Params:** <kbd>item</kbd> `Item` · <kbd>disabled</kbd> `boolean`

Mass-toggle: apply opt-out to every resource type the item has (or clear all).

</details>

<details id="isAutoConsumeDisabled">
<summary><b><code>isAutoConsumeDisabled</code></b> → <code>boolean</code></summary>

<br>

```js
if (api.isAutoConsumeDisabled(item, 'uses')) { ... }
```

**Params:** <kbd>item</kbd> `Item` · <kbd>type</kbd> `string` resource key

</details>

<details id="getAutoConsumeDisabled">
<summary><b><code>getAutoConsumeDisabled</code></b> → <code>Set&lt;string&gt;</code></summary>

<br>

```js
const disabled = api.getAutoConsumeDisabled(item);  // Set of type keys
```

**Params:** <kbd>item</kbd> `Item`

</details>

<details id="consumeItemResource">
<summary><b><code>consumeItemResource</code></b> <sup>async</sup> → <code>number|boolean|null</code></summary>

<br>

```js
await api.consumeItemResource(item, 'uses', 2);   // uses -= 2 (clamped to 0)
await api.consumeItemResource(item, 'loading');   // loaded = false
```

Force a consume regardless of opt-out. Throws if the item does not have the resource type. Numeric fields clamp to `[0, max]`. Booleans set to `false`.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>item</kbd> | `Item` | *required* | Owned Lancer item |
| <kbd>type</kbd> | `string` | *required* | Resource key |
| <kbd>amount</kbd> | `number` | `1` | Positive integer for numeric fields, ignored for booleans |

</details>

<details id="rechargeItemResource">
<summary><b><code>rechargeItemResource</code></b> <sup>async</sup> → <code>number|boolean|null</code></summary>

<br>

```js
await api.rechargeItemResource(item, 'uses', 3);  // uses += 3 (clamped to max)
await api.rechargeItemResource(item, 'charged'); // charged = true
```

**Params:** <kbd>item</kbd> `Item` · <kbd>type</kbd> `string` resource key · <kbd>amount</kbd> `number` (default `1`)

Reverse of consume. Same signature, same validation.

</details>

<details id="configureItemExtraConfig">
<summary><b><code>configureItemExtraConfig</code></b> <sup>async</sup> → <code>object</code></summary>

<br>

```js
await api.configureItemExtraConfig(item, { autoConsumeDisabled: ['uses', 'loading'] });
```

**Params:** <kbd>item</kbd> `Item` · <kbd>patch</kbd> `Object` shallow-merged fields

Generic setter that shallow-merges a patch into the Extra Config flag. Prefer the explicit `setItemAutoConsumeDisabled*` helpers for the auto-consume feature. Use this only for fields with no helper.

</details>

<details id="getExtraConfig">
<summary><b><code>getExtraConfig</code></b> → <code>object|null</code></summary>

<br>

```js
const cfg = api.getExtraConfig(item);
```

**Params:** <kbd>item</kbd> `Item`

Returns the full Extra Config flag object, or `null` if never configured.

</details>

### Consume Feedback

Any change to an item's consumable field (via API, Lancer flow, sheet click, TAH detail) triggers a floating text label above the actor's token + a `generic_stat` sound. To suppress for a specific update, pass `options.laConsumeFeedback = false` to `item.update(...)`.
