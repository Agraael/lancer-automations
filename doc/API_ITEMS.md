# API - Items

[Back to API Reference](API_REFERENCE.md)

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

<details id="isItemUsable">
<summary><b><code>isItemUsable</code></b> → <code>boolean</code></summary>

<br>

```js
api.isItemUsable(item)
```

Whether the item can be used right now, matching the TAH row state: false when destroyed, disabled, unloaded, uncharged, out of uses or per-round/turn/scene limits, or lock-blocked.

The per-round/turn/scene part only counts when the `enablePerRoundTurnTags` setting is on. Those three are the `perRound` / `perTurn` / `perScene` resources of [Extra Config](#extra-config).

</details>

---

## Activated Items

<details id="setItemAsActivated">
<summary><b><code>setItemAsActivated</code></b> <sup>async</sup> → <code>Promise&lt;Item&gt;</code></summary>

<br>

```js
await api.setItemAsActivated(item, token, endAction, endActionDescription, options)
```

Marks an item as activated, so it shows as active in the HUD and appears in `getActivatedItems`. `endAction` is the action the player spends to end it, surfaced on the end-activation entry. Close it with `endItemActivation`.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>item</kbd> | `Item` | *required* | The item to mark |
| <kbd>token</kbd> | `Token` | *required* | Owner of the item |
| <kbd>endAction</kbd> | `string` | *required* | Action spent to end it, e.g. `"Quick"` / `"Full"` |
| <kbd>endActionDescription</kbd> | `string` | `""` | Text shown when ending the activation |
| **inside `options`** | | | |
| <kbd>blockAction</kbd> | `boolean` | `true` | Lock the action while the item is active. `false` opts out |
| <kbd>actionName</kbd> | `string` | the item name | Which action to lock |
| <kbd>blockReason</kbd> | `string` | `"<item> is already active."` | Reason shown on the locked row |

By default this also takes an action lock, so the action named after the item cannot be used again while the activation stands. `endItemActivation` releases that lock. That is why the pairing is mandatory: end the activation any other way and the action stays locked.

```js
await api.setItemAsActivated(item, token, 'Quick', 'Deactivate the shield.');
await api.setItemAsActivated(item, token, 'Quick', 'Deactivate the shield.', { blockAction: false });
```

</details>

<details id="getActivatedItems">
<summary><b><code>getActivatedItems</code></b> → <code>Array&lt;Item&gt;</code></summary>

<br>

```js
api.getActivatedItems(token)
```

Items on the token carrying `lancer-automations.activeStateData.active`, the flag `setItemAsActivated` writes.

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

Ends an activation started by `setItemAsActivated`: clears the activated flags, releases the action lock it took, and posts the end-of-activation chat message through `SimpleActivationFlow`. Resolves whether the flow completed.

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

Prompt listing the token's activated items. The picked one is ended via `endItemActivation`. Resolves the ended item, or `null` on cancel.

**Params:** <kbd>token</kbd> `Token` holder of the activated items

</details>

<details id="destroyItem">
<summary><b><code>destroyItem</code></b> <sup>async</sup> → <code>Promise&lt;Item | null&gt;</code><br><b><code>disableItem</code></b> <sup>async</sup> → <code>Promise&lt;Item | null&gt;</code><br><b><code>restoreItem</code></b> <sup>async</sup> → <code>Promise&lt;Item | null&gt;</code></summary>

<br>

```js
await api.destroyItem(item)
await api.disableItem(item)
await api.restoreItem(item)
```

**Params:** <kbd>item</kbd> `Item`

`destroyItem` sets `system.destroyed`, `disableItem` sets `system.disabled`, and `restoreItem` clears both. Destroyed/disabled items are skipped by the reaction engine and the action-lock system, and Lancer greys them on the sheet. Returns the item, or `null` if the argument is not an Item.

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

Reads the reaction flag on the actor's action tracker. Always `true` when the actor has no combatant in the active combat, and when a combat exists but has not been started.

**Params:** <kbd>tokenOrActor</kbd> `Token|Actor`

```js
if (!api.hasReactionAvailable(reactorToken)) return false;
```

</details>

<details id="isCombatant">
<summary><b><code>isCombatant</code></b> → <code>boolean</code></summary>

<br>

```js
api.isCombatant(tokenOrActor)
```

`true` when the token has a combatant in the started active combat. `false` outside combat or before the combat starts.

**Params:** <kbd>tokenOrActor</kbd> `Token|Actor`

```js
if (!api.isCombatant(reactorToken)) return false;
```

</details>

<details id="isCurrentTurnActive">
<summary><b><code>isCurrentTurnActive</code></b> → <code>boolean</code></summary>

<br>

```js
api.isCurrentTurnActive(tokenOrActor)
```

`true` while it is this token's turn in the active combat. `false` outside combat.

**Params:** <kbd>tokenOrActor</kbd> `Token|Actor`

```js
if (!api.isCurrentTurnActive(reactorToken)) return false;
```

</details>

<details id="hasTurnAvailable">
<summary><b><code>hasTurnAvailable</code></b> → <code>number</code></summary>

<br>

```js
api.hasTurnAvailable(tokenOrActor)
```

Activations the token still has this round, read from its combatant. `0` outside a started combat.

**Params:** <kbd>tokenOrActor</kbd> `Token|Actor`

```js
if (api.hasTurnAvailable(reactorToken) === 0) return false;
```

</details>

<details id="setItemResource">
<summary><b><code>setItemResource</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.setItemResource(item, value, counterIndex)
```

Auto-detects the resource type.

Detection order:
1. **Talent** → `system.counters[counterIndex].value` (clamped to counter `min`/`max`)
2. **Uses** (`uses.max > 0`) → `system.uses.value` (clamped `0..max`)
3. **Loaded** → `system.loaded` (`Boolean(value)`)
4. **Charged** → `system.charged` (`Boolean(value)`)

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>item</kbd> | `Item` | *required* | The item document to update |
| <kbd>value</kbd> | `number\|boolean` | *required* | Target value. For `loaded`/`charged`: truthy/falsy. For `uses`/counters: number (clamped to valid range). |
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

Routes through the GM via socket when the calling user does not own the actor.

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

Per-item config controlling Lancer's automation of the item: whether a resource is auto-consumed on activation, and when a per-X counter is spent. Stored at `item.flags['lancer-automations'].extraConfig`.

Nested actions with their own `N/round` frequency have a separate counter, addressed by a sub key: `a{N}` for `system.actions[N]`, `p{P}a{N}` for a weapon profile action, `r{N}` for a talent rank.

**Resource keys, and which functions take them:**

| Key | Auto-consume opt-out | Sub / consume-on | Consume / recharge |
|:----|:---------------------|:-----------------|:-------------------|
| <kbd>uses</kbd> | yes | - | yes |
| <kbd>loading</kbd> | yes | - | yes |
| <kbd>charged</kbd> | yes | - | yes |
| <kbd>perTurn</kbd> | yes | yes | yes |
| <kbd>perRound</kbd> | yes | yes | yes |
| <kbd>perScene</kbd> | yes | yes | yes |
| <kbd>reserveUsed</kbd> | yes | - | yes |

- **Auto-consume opt-out**: `setItemAutoConsumeDisabled`, `isAutoConsumeDisabled`, `getAutoConsumeDisabled`.
- **Sub / consume-on**: `setSubAutoConsumeDisabled`, `getSubAutoConsumeDisabled`, `setConsumeOn`, `getConsumeOn`. Only the per-X keys have their own counter to address.
- **Consume / recharge**: `consumeItemResource`, `rechargeItemResource`.

<details id="setItemAutoConsumeDisabled">
<summary><b><code>setItemAutoConsumeDisabled</code></b> <sup>async</sup> → <code>string[]</code></summary>

<br>

```js
await api.setItemAutoConsumeDisabled(item, 'uses', true);
```

`true` = do NOT decrement on activation. `false` = default behavior.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>item</kbd> | `Item` | Owned Lancer item |
| <kbd>type</kbd> | `'uses'\|'loading'\|'charged'\|'perTurn'\|'perRound'\|'perScene'\|'reserveUsed'` | Resource key |
| <kbd>disabled</kbd> | `boolean` | true = opt out |

Returns the updated opt-out array.

</details>

<details id="setItemAutoConsumeDisabledAll">
<summary><b><code>setItemAutoConsumeDisabledAll</code></b> <sup>async</sup> → <code>string[]</code></summary>

<br>

```js
await api.setItemAutoConsumeDisabledAll(item, true);
```

**Params:** <kbd>item</kbd> `Item` · <kbd>disabled</kbd> `boolean`

Mass-toggle: apply opt-out to every resource type the item has (or clear all), nested action counters included.

</details>

<details id="setSubAutoConsumeDisabled">
<summary><b><code>setSubAutoConsumeDisabled</code></b> <sup>async</sup> → <code>string[]</code></summary>

<br>

```js
await api.setSubAutoConsumeDisabled(item, 'a0', 'perRound', true);
```

**Params:** <kbd>item</kbd> `Item` · <kbd>subKey</kbd> `string` · <kbd>type</kbd> `'perTurn'|'perRound'|'perScene'` · <kbd>disabled</kbd> `boolean`

Opt-out for one nested action's own counter.

</details>

<details id="getSubAutoConsumeDisabled">
<summary><b><code>getSubAutoConsumeDisabled</code></b> → <code>Set&lt;string&gt;</code></summary>

<br>

```js
const off = api.getSubAutoConsumeDisabled(item, 'a0');
```

**Params:** <kbd>item</kbd> `Item` · <kbd>subKey</kbd> `string`

The opt-out set for one nested action. Empty `Set` when that action has none.

</details>

<details id="setConsumeOn">
<summary><b><code>setConsumeOn</code></b> <sup>async</sup> → <code>Object</code></summary>

<br>

```js
await api.setConsumeOn(item, 'perRound', 'hit');
```

**Params:** <kbd>item</kbd> `Item` · <kbd>type</kbd> `'perTurn'|'perRound'|'perScene'` · <kbd>mode</kbd> `'auto'|'activation'|'hit'`

When a weapon attack spends the counter. `auto` detects it from the text (`N/round` in `on_hit` / `on_crit` = on hit).

</details>

<details id="getConsumeOn">
<summary><b><code>getConsumeOn</code></b> → <code>'auto'|'activation'|'hit'</code></summary>

<br>

```js
const mode = api.getConsumeOn(item, 'perRound');
```

**Params:** <kbd>item</kbd> `Item` · <kbd>type</kbd> `'perTurn'|'perRound'|'perScene'`

The mode set by `setConsumeOn`, or `'auto'` when none was set.

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
const disabled = api.getAutoConsumeDisabled(item);
```

**Params:** <kbd>item</kbd> `Item`

</details>

<details id="consumeItemResource">
<summary><b><code>consumeItemResource</code></b> <sup>async</sup> → <code>number|boolean|null</code></summary>

<br>

```js
await api.consumeItemResource(item, 'uses', 2);
await api.consumeItemResource(item, 'loading');
```

Force a consume regardless of opt-out. Throws if the item does not have the resource type. Booleans set to `false`.

Only `uses` clamps to a real ceiling (`system.uses.max`). `perTurn` and `perRound` are floored at 0 with no upper bound, so a recharge past the tag's limit is not caught here.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>item</kbd> | `Item` | *required* | Owned Lancer item |
| <kbd>type</kbd> | `string` | *required* | Resource key, see the table above |
| <kbd>amount</kbd> | `number` | `1` | Positive integer for numeric fields, ignored for booleans |

</details>

<details id="rechargeItemResource">
<summary><b><code>rechargeItemResource</code></b> <sup>async</sup> → <code>number|boolean|null</code></summary>

<br>

```js
await api.rechargeItemResource(item, 'uses', 3);
await api.rechargeItemResource(item, 'charged');
```

**Params:** <kbd>item</kbd> `Item` · <kbd>type</kbd> `string` resource key · <kbd>amount</kbd> `number` (default `1`)

Reverse of consume. Same signature, same validation, same clamping.

</details>

<details id="configureItemExtraConfig">
<summary><b><code>configureItemExtraConfig</code></b> <sup>async</sup> → <code>object</code></summary>

<br>

```js
await api.configureItemExtraConfig(item, { autoConsumeDisabled: ['uses', 'loading'] });
```

**Params:** <kbd>item</kbd> `Item` · <kbd>patch</kbd> `Object` merged into the stored config

Generic setter for Extra Config fields with no helper. Prefer the explicit `setItemAutoConsumeDisabled*` helpers for the auto-consume feature.

The patch's top-level keys replace the stored ones, but the write itself goes through `setFlag`, which merges nested objects recursively. Passing `{ consumeOn: {} }` therefore does not clear the stored `consumeOn` keys. Arrays are replaced whole.

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
