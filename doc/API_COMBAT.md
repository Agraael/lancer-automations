# API — Combat, Spatial & Item Tools

[Back to API Reference](API_REFERENCE.md)

---

## Combat & Execution Flows

<details>
<summary><b><code>executeStatRoll</code></b> <sup>async</sup> → <code>{completed, total, roll, passed}</code></summary>

<br>

```js
await api.executeStatRoll(actor, stat, title, target, extraData)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actor</kbd> | `Actor` | *required* | The actor making the roll |
| <kbd>stat</kbd> | `string` | *required* | `"HULL"`, `"AGI"`, `"SYS"`, `"ENG"`, `"GRIT"` |
| <kbd>title</kbd> | `string` | auto | Roll title |
| <kbd>target</kbd> | `number\|"token"` | `10` | Pass threshold or `"token"` for interactive choice |
| <kbd>extraData</kbd> | `Object` | `{}` | `{ targetStat: "HULL" }` to use a different stat for difficulty lookup |

</details>

---

<details>
<summary><b><code>executeDamageRoll</code></b> <sup>async</sup> → <code>{completed, flow}</code></summary>

<br>

```js
await api.executeDamageRoll(attacker, targets, damageValue, damageType, title, options, extraData)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>attacker</kbd> | `Token\|Actor` | *required* | The attacker |
| <kbd>targets</kbd> | `Array<Token>` | *required* | Damage targets |
| <kbd>damageValue</kbd> | `number` | `null` | Base damage |
| <kbd>damageType</kbd> | `string` | `null` | kinetic, energy, explosive, burn, heat, variable |
| <kbd>title</kbd> | `string` | `"Damage Roll"` | Roll title |
| <kbd>options</kbd> | `Object` | `{}` | Flow options (see below) |
| <kbd>extraData</kbd> | `Object` | `{}` | Injected state data |

**`options` keys:**
`{ ap, paracausal, overkill, reliable, half_damage, add_burn, invade, has_normal_hit, has_crit_hit, tags, bonus_damage, hit_results }`

</details>

---

<details>
<summary><b><code>executeBasicAttack</code></b> <sup>async</sup> → <code>{completed, flow}</code></summary>

<br>

```js
await api.executeBasicAttack(actor, options, extraData)
```

Starts a `BasicAttackFlow`. The `options` object is passed directly to the flow constructor.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actor</kbd> | `Actor` | *required* | The actor making the attack |
| <kbd>options</kbd> | `Object` | `{}` | Flow constructor options |
| <kbd>extraData</kbd> | `Object` | `{}` | Injected into `state.la_extraData` |

</details>

---

<details>
<summary><b><code>executeTechAttack</code></b> <sup>async</sup> → <code>{completed, flow}</code></summary>

<br>

```js
await api.executeTechAttack(target, options, extraData)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>target</kbd> | `Actor\|Item` | *required* | The actor or item initiating the tech attack |
| <kbd>options</kbd> | `Object` | `{}` | Flow options |
| <kbd>extraData</kbd> | `Object` | `{}` | Injected state data |

</details>

---

<details>
<summary><b><code>executeSimpleActivation</code></b> <sup>async</sup> → <code>{completed, flow}</code></summary>

<br>

```js
await api.executeSimpleActivation(actor, options, extraData)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>title</kbd> | `string` | `""` | Card/Match title |
| <kbd>action</kbd> | `Object` | `null` | `{ name, activation }` |
| <kbd>detail</kbd> | `string` | `""` | Description text |
| <kbd>tags</kbd> | `Array` | `[]` | Lancer tags |

</details>

---

<details>
<summary><b><code>executeSkirmish</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.executeSkirmish(actorOrToken, bypassMount, preTarget, weaponFilter)
```

Executes a Skirmish action. Optionally bypasses mount selection or pre-targets a token.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actorOrToken</kbd> | `Token\|Actor` | *required* | The actor or token performing the skirmish |
| <kbd>bypassMount</kbd> | `Object` | `null` | Mount object to skip mount selection |
| <kbd>preTarget</kbd> | `Token` | `null` | Pre-selected target token |
| <kbd>weaponFilter</kbd> | `Function` | `null` | `(weapon) => boolean` filter for available weapons |

</details>

---

<details>
<summary><b><code>beginWeaponAttackFlow</code></b> <sup>async</sup> → <code>{completed, flow?}</code></summary>

<br>

```js
await api.beginWeaponAttackFlow(weapon, options, extraData)
```

Starts a weapon attack flow for a specific weapon item. Use it when you need to trigger an attack with a known weapon directly (e.g. an NPC's specific rifle).

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>weapon</kbd> | `Item` | *required* | The weapon item to attack with |
| <kbd>options</kbd> | `Object` | `{}` | Flow options |
| <kbd>extraData</kbd> | `Object` | `{}` | Injected state data |

</details>

---

## Spatial & Distance Tools

### Distance Calculations

Three distance functions at different abstraction levels. All return distance in **grid spaces** (not pixels).

| Function | Input | Size-aware | Use case |
|:---------|:------|:---:|:---------|
| `getTokenDistance` | Two tokens | Yes | General token-to-token distance. Wraps `getMinGridDistance`. |
| `getMinGridDistance` | Two tokens + optional override pos + optional elevation flag | Yes | Iterates all occupied cells of both tokens, returns the shortest cell-to-cell distance. Supports hypothetical positioning via `overridePos1`. Optional `includeElevation` adds elevation difference to the planar distance. |
| `getGridDistance` | Two `{x,y}` world points | No | Raw point-to-point grid distance. Use when you have coordinates, not tokens. |

<details>
<summary><b><code>getTokenDistance</code></b> → <code>number</code></summary>

<br>

```js
api.getTokenDistance(token1, token2)
```

Delegates to `getMinGridDistance(token1, token2)`.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token1</kbd> | `Token` | First token |
| <kbd>token2</kbd> | `Token` | Second token |

</details>

---

<details>
<summary><b><code>getMinGridDistance</code></b> → <code>number</code></summary>

<br>

```js
api.getMinGridDistance(token1, token2, overridePos1, includeElevation)
```

Minimum cell-to-cell grid distance across all occupied cell pairs.

When `includeElevation` is `true`, the elevation difference (converted to grid spaces) is **added** to the planar distance — e.g. 1 horizontal + 2 vertical = 3. When `false` (default), elevation is ignored (purely 2D).

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>token1</kbd> | `Token` | *required* | First token |
| <kbd>token2</kbd> | `Token` | *required* | Second token |
| <kbd>overridePos1</kbd> | `{x, y}` | `null` | Evaluate as if token1 were at this world position |
| <kbd>includeElevation</kbd> | `boolean` | `false` | If `true`, add `|elevation1 − elevation2|` (in grid spaces) to the planar result |

</details>

---

<details>
<summary><b><code>getGridDistance</code></b> → <code>number</code></summary>

<br>

```js
api.getGridDistance(pos1, pos2)
```

Hex grids: cube distance. Square grids: `measurePath` rounded to grid units.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>pos1</kbd> | `{x, y}` | World coordinates |
| <kbd>pos2</kbd> | `{x, y}` | World coordinates |

</details>

---

### Faction & Disposition

<details>
<summary><b><code>isHostile</code></b> → <code>boolean</code></summary>

<br>

```js
api.isHostile(reactor, mover)
```

Checks if two tokens are hostile. Compatible with the Token Factions module.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>reactor</kbd> | `Token` | The reacting token |
| <kbd>mover</kbd> | `Token` | The triggering token |

</details>

---

<details>
<summary><b><code>isFriendly</code></b> → <code>boolean</code></summary>

<br>

```js
api.isFriendly(token1, token2)
```

Checks if two tokens are friendly. Compatible with the Token Factions module.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token1</kbd> | `Token` | First token |
| <kbd>token2</kbd> | `Token` | Second token |

</details>

---

### Grid & Cell Data

<details>
<summary><b><code>getTokenCells</code></b> → <code>Array&lt;[row, col]&gt;</code></summary>

<br>

```js
api.getTokenCells(token)
```

Returns the grid cells occupied by a token.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token` | The token to inspect |

</details>

---

<details>
<summary><b><code>getMaxGroundHeightUnderToken</code></b> → <code>number</code></summary>

<br>

```js
api.getMaxGroundHeightUnderToken(token, terrainAPI)
```

Returns the highest terrain height value under any cell occupied by the token. Requires the Terrain Height Tools module API.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token` | The token to check |
| <kbd>terrainAPI</kbd> | `Object` | Terrain Height Tools API object |

</details>

---

### Debug Visualizations

<details>
<summary><b><code>drawThreatDebug</code></b> · <b><code>drawDistanceDebug</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.drawThreatDebug(token)    // Draws threat range cells on canvas. Hex grids only.
await api.drawDistanceDebug()       // Select 2 tokens, draws shortest distance line.
```

</details>

---

<details>
<summary><b><code>drawRangeHighlight</code></b> → <code>PIXI.Graphics</code></summary>

<br>

```js
api.drawRangeHighlight(casterToken, range, color, alpha, includeSelf)
```

Draws a range highlight on the canvas.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>casterToken</kbd> | `Token\|{x, y}` | *required* | Origin token or point |
| <kbd>range</kbd> | `number` | *required* | Radius in grid spaces |
| <kbd>color</kbd> | `number` | `0x00ff00` | Hex color |
| <kbd>alpha</kbd> | `number` | `0.2` | Opacity (0-1) |
| <kbd>includeSelf</kbd> | `boolean` | `false` | Include origin cells |

</details>

---

## Weapon & Item Details

These functions provide processed information about weapons and items, often accounting for active actor bonuses (e.g., Accuracy, Threat bonuses).

<details>
<summary><b><code>getItemTags_WithBonus</code></b> <sup>async</sup> → <code>Array&lt;Object&gt;</code></summary>

<br>

```js
await api.getItemTags_WithBonus(item, actor)
```

Returns the effective tag list for a single item, with actor bonuses applied.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>item</kbd> | `Item` | *required* | The item to inspect |
| <kbd>actor</kbd> | `Actor` | `item.parent` | The actor whose bonuses should be applied |

</details>

---

<details>
<summary><b><code>getActorMaxThreat</code></b> <sup>async</sup> → <code>number</code></summary>

<br>

```js
await api.getActorMaxThreat(actor)
```

Returns the highest Threat range across all weapons held by the actor, accounting for active bonuses.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>actor</kbd> | `Actor` | The actor to inspect |

</details>

---

<details>
<summary><b><code>getMaxWeaponRanges_WithBonus</code></b> <sup>async</sup> → <code>Object</code></summary>

<br>

```js
await api.getMaxWeaponRanges_WithBonus(input)
// e.g. returns { Range: 25, Burst: 3 }
```

Returns the maximum range value per range type across all weapons provided in the input.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>input</kbd> | `Actor\|Token\|Item\|Array` | The source(s) to scan for weapons |

</details>

---

<details>
<summary><b><code>getMaxWeaponReach_WithBonus</code></b> <sup>async</sup> → <code>number</code></summary>

<br>

```js
await api.getMaxWeaponReach_WithBonus(input)
```

Returns the single highest reach value across all scanned weapons. Scans `Range`, `Threat`, `Line`, `Burst`, and `Cone` (ignores `Blast`). Also accounts for the `tg_thrown` tag.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>input</kbd> | `Actor\|Token\|Item\|Array` | The source(s) to scan for weapons |

</details>

---

#### Simple lookups

| Function | Returns | Description |
|:---------|:--------|:------------|
| `getWeaponType(item)` | `string` | Weapon subtype (e.g. `"Superheavy Rifle"`, `"Melee"`). Synchronous, no bonuses. |
| `getItemType(item)` | `string` | Lancer item type (e.g. `"Weapon"`, `"System"`, `"mech_weapon"`). |
| `getActivationIcon(actionOrActivation)` | `string` | Icon path or CSS class. Accepts `"reaction"`, `"quick"`, `"full"`, `"protocol"`, `"free"` or an action object. |

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
