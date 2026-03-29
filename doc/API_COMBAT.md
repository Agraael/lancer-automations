<h1>API — Combat, Spatial & Item Tools</h1>

[Back to API Reference](API_REFERENCE.md)

<br>

<h2>Combat & Execution Flows</h2>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>executeStatRoll</code></h4> <sup>async</sup> → <code>{completed, total, roll, passed}</code></summary>

```js
await api.executeStatRoll(actor, stat, title, target, extraData)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">actor</b> | `Actor` | *required* | The actor making the roll |
| <b style="color:#e0a050">stat</b> | `string` | *required* | `"HULL"`, `"AGI"`, `"SYS"`, `"ENG"`, `"GRIT"` |
| <b style="color:#e0a050">title</b> | `string` | auto | Roll title |
| <b style="color:#e0a050">target</b> | `number\|"token"` | `10` | Pass threshold or `"token"` for interactive choice |
| <b style="color:#e0a050">extraData</b> | `Object` | `{}` | `{ targetStat: "HULL" }` to use a different stat for difficulty lookup |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>executeDamageRoll</code></h4> <sup>async</sup> → <code>{completed, flow}</code></summary>

```js
await api.executeDamageRoll(attacker, targets, damageValue, damageType, title, options, extraData)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">attacker</b> | `Token\|Actor` | *required* | The attacker |
| <b style="color:#e0a050">targets</b> | `Array<Token>` | *required* | Damage targets |
| <b style="color:#e0a050">damageValue</b> | `number` | `null` | Base damage |
| <b style="color:#e0a050">damageType</b> | `string` | `null` | kinetic, energy, explosive, burn, heat, variable |
| <b style="color:#e0a050">title</b> | `string` | `"Damage Roll"` | Roll title |
| <b style="color:#e0a050">options</b> | `Object` | `{}` | Flow options (see below) |
| <b style="color:#e0a050">extraData</b> | `Object` | `{}` | Injected state data |

**`options` keys:**
`{ ap, paracausal, overkill, reliable, half_damage, add_burn, invade, has_normal_hit, has_crit_hit, tags, bonus_damage, hit_results }`

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>executeBasicAttack</code></h4> <sup>async</sup> → <code>{completed, flow}</code></summary>

```js
await api.executeBasicAttack(actor, options, extraData)
```

Starts a `BasicAttackFlow`. The `options` object is passed directly to the flow constructor.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">actor</b> | `Actor` | *required* | The actor making the attack |
| <b style="color:#e0a050">options</b> | `Object` | `{}` | Flow constructor options |
| <b style="color:#e0a050">extraData</b> | `Object` | `{}` | Injected into `state.la_extraData` |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>executeTechAttack</code></h4> <sup>async</sup> → <code>{completed, flow}</code></summary>

```js
await api.executeTechAttack(target, options, extraData)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">target</b> | `Actor\|Item` | *required* | The actor or item initiating the tech attack |
| <b style="color:#e0a050">options</b> | `Object` | `{}` | Flow options |
| <b style="color:#e0a050">extraData</b> | `Object` | `{}` | Injected state data |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>executeSimpleActivation</code></h4> <sup>async</sup> → <code>{completed, flow}</code></summary>

```js
await api.executeSimpleActivation(actor, options, extraData)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">title</b> | `string` | `""` | Card/Match title |
| <b style="color:#e0a050">action</b> | `Object` | `null` | `{ name, activation }` |
| <b style="color:#e0a050">detail</b> | `string` | `""` | Description text |
| <b style="color:#e0a050">tags</b> | `Array` | `[]` | Lancer tags |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>executeSkirmish</code></h4> <sup>async</sup> → <code>void</code></summary>

```js
await api.executeSkirmish(actorOrToken, bypassMount, preTarget, weaponFilter)
```

Executes a Skirmish action. Optionally bypasses mount selection or pre-targets a token.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">actorOrToken</b> | `Token\|Actor` | *required* | The actor or token performing the skirmish |
| <b style="color:#e0a050">bypassMount</b> | `Object` | `null` | Mount object to skip mount selection |
| <b style="color:#e0a050">preTarget</b> | `Token` | `null` | Pre-selected target token |
| <b style="color:#e0a050">weaponFilter</b> | `Function` | `null` | `(weapon) => boolean` filter for available weapons |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>beginWeaponAttackFlow</code></h4> <sup>async</sup> → <code>{completed, flow?}</code></summary>

```js
await api.beginWeaponAttackFlow(weapon, options, extraData)
```

Starts a weapon attack flow for a specific weapon item. Use it when you need to trigger an attack with a known weapon directly (e.g. an NPC's specific rifle).

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">weapon</b> | `Item` | *required* | The weapon item to attack with |
| <b style="color:#e0a050">options</b> | `Object` | `{}` | Flow options |
| <b style="color:#e0a050">extraData</b> | `Object` | `{}` | Injected state data |

</details>

<br>

<h2>Spatial & Distance Tools</h2>

<!-- ═══════════════════════════════════════════════════════════════ -->

<h3>Distance Calculations</h3>

Three distance functions at different abstraction levels. All return distance in **grid spaces** (not pixels).

| Function | Input | Size-aware | Use case |
|:---------|:------|:---:|:---------|
| `getTokenDistance` | Two tokens | Yes | General token-to-token distance. Wraps `getMinGridDistance`. |
| `getMinGridDistance` | Two tokens + optional override pos | Yes | Iterates all occupied cells of both tokens, returns the shortest cell-to-cell distance. Supports hypothetical positioning via `overridePos1`. |
| `getGridDistance` | Two `{x,y}` world points | No | Raw point-to-point grid distance. Use when you have coordinates, not tokens. |

<br>

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getTokenDistance</code></h4> → <code>number</code></summary>

```js
api.getTokenDistance(token1, token2)
```

Delegates to `getMinGridDistance(token1, token2)`.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">token1</b> | `Token` | First token |
| <b style="color:#e0a050">token2</b> | `Token` | Second token |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getMinGridDistance</code></h4> → <code>number</code></summary>

```js
api.getMinGridDistance(token1, token2, overridePos1)
```

Minimum cell-to-cell grid distance across all occupied cell pairs.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">token1</b> | `Token` | *required* | First token |
| <b style="color:#e0a050">token2</b> | `Token` | *required* | Second token |
| <b style="color:#e0a050">overridePos1</b> | `{x, y}` | `null` | Evaluate as if token1 were at this world position |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getGridDistance</code></h4> → <code>number</code></summary>

```js
api.getGridDistance(pos1, pos2)
```

Hex grids: cube distance. Square grids: `measurePath` rounded to grid units.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">pos1</b> | `{x, y}` | World coordinates |
| <b style="color:#e0a050">pos2</b> | `{x, y}` | World coordinates |

</details>

<br>

<!-- ═══════════════════════════════════════════════════════════════ -->

<h3>Faction & Disposition</h3>

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>isHostile</code></h4> → <code>boolean</code></summary>

```js
api.isHostile(reactor, mover)
```

Checks if two tokens are hostile. Compatible with the Token Factions module.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">reactor</b> | `Token` | The reacting token |
| <b style="color:#e0a050">mover</b> | `Token` | The triggering token |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>isFriendly</code></h4> → <code>boolean</code></summary>

```js
api.isFriendly(token1, token2)
```

Checks if two tokens are friendly. Compatible with the Token Factions module.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">token1</b> | `Token` | First token |
| <b style="color:#e0a050">token2</b> | `Token` | Second token |

</details>

<br>

<!-- ═══════════════════════════════════════════════════════════════ -->

<h3>Grid & Cell Data</h3>

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getTokenCells</code></h4> → <code>Array&lt;[row, col]&gt;</code></summary>

```js
api.getTokenCells(token)
```

Returns the grid cells occupied by a token.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">token</b> | `Token` | The token to inspect |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getMaxGroundHeightUnderToken</code></h4> → <code>number</code></summary>

```js
api.getMaxGroundHeightUnderToken(token, terrainAPI)
```

Returns the highest terrain height value under any cell occupied by the token. Requires the Terrain Height Tools module API.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">token</b> | `Token` | The token to check |
| <b style="color:#e0a050">terrainAPI</b> | `Object` | Terrain Height Tools API object |

</details>

<br>

<!-- ═══════════════════════════════════════════════════════════════ -->

<h3>Debug Visualizations</h3>

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>drawThreatDebug</code></h4> <sup>async</sup> → <code>void</code> · <h4 style="display:inline"><code>drawDistanceDebug</code></h4> <sup>async</sup> → <code>void</code></summary>

```js
await api.drawThreatDebug(token)    // Draws threat range cells on canvas. Hex grids only.
await api.drawDistanceDebug()       // Select 2 tokens, draws shortest distance line.
```

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>drawRangeHighlight</code></h4> → <code>PIXI.Graphics</code></summary>

```js
api.drawRangeHighlight(casterToken, range, color, alpha, includeSelf)
```

Draws a range highlight on the canvas.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">casterToken</b> | `Token\|{x, y}` | *required* | Origin token or point |
| <b style="color:#e0a050">range</b> | `number` | *required* | Radius in grid spaces |
| <b style="color:#e0a050">color</b> | `number` | `0x00ff00` | Hex color |
| <b style="color:#e0a050">alpha</b> | `number` | `0.2` | Opacity (0-1) |
| <b style="color:#e0a050">includeSelf</b> | `boolean` | `false` | Include origin cells |

</details>

<br>

<h2>Weapon & Item Details</h2>

These functions provide processed information about weapons and items, often accounting for active actor bonuses (e.g., Accuracy, Threat bonuses).

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getItemTags_WithBonus</code></h4> <sup>async</sup> → <code>Array&lt;Object&gt;</code></summary>

```js
await api.getItemTags_WithBonus(item, actor)
```

Returns the effective tag list for a single item, with actor bonuses applied.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">item</b> | `Item` | *required* | The item to inspect |
| <b style="color:#e0a050">actor</b> | `Actor` | `item.parent` | The actor whose bonuses should be applied |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getActorMaxThreat</code></h4> <sup>async</sup> → <code>number</code></summary>

```js
await api.getActorMaxThreat(actor)
```

Returns the highest Threat range across all weapons held by the actor, accounting for active bonuses.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">actor</b> | `Actor` | The actor to inspect |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getMaxWeaponRanges_WithBonus</code></h4> <sup>async</sup> → <code>Object</code></summary>

```js
await api.getMaxWeaponRanges_WithBonus(input)
// e.g. returns { Range: 25, Burst: 3 }
```

Returns the maximum range value per range type across all weapons provided in the input.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">input</b> | `Actor\|Token\|Item\|Array` | The source(s) to scan for weapons |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getMaxWeaponReach_WithBonus</code></h4> <sup>async</sup> → <code>number</code></summary>

```js
await api.getMaxWeaponReach_WithBonus(input)
```

Returns the single highest reach value across all scanned weapons. Scans `Range`, `Threat`, `Line`, `Burst`, and `Cone` (ignores `Blast`). Also accounts for the `tg_thrown` tag.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">input</b> | `Actor\|Token\|Item\|Array` | The source(s) to scan for weapons |

</details>

<br>

<!-- ═══════════════════════════════════════════════════════════════ -->

<h4>Simple lookups</h4>

| Function | Returns | Description |
|:---------|:--------|:------------|
| `getWeaponType(item)` | `string` | Weapon subtype (e.g. `"Superheavy Rifle"`, `"Melee"`). Synchronous, no bonuses. |
| `getItemType(item)` | `string` | Lancer item type (e.g. `"Weapon"`, `"System"`, `"mech_weapon"`). |
| `getActivationIcon(actionOrActivation)` | `string` | Icon path or CSS class. Accepts `"reaction"`, `"quick"`, `"full"`, `"protocol"`, `"free"` or an action object. |

<br>

<h2>Resource Management</h2>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>setReaction</code></h4> <sup>async</sup> → <code>void</code></summary>

```js
await api.setReaction(actorOrToken, value)
```

Sets the reaction availability flag on an actor's action tracker.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">actorOrToken</b> | `Token\|Actor` | The token or actor to update |
| <b style="color:#e0a050">value</b> | `boolean` | `true` = reaction available, `false` = reaction spent |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>setItemResource</code></h4> <sup>async</sup> → <code>void</code></summary>

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
| <b style="color:#e0a050">item</b> | `Item` | *required* | The item document to update |
| <b style="color:#e0a050">nb</b> | `number\|boolean` | *required* | Target value. For `loaded`/`charged`: truthy/falsy. For `uses`/counters: number (clamped to valid range). |
| <b style="color:#e0a050">counterIndex</b> | `number` | `0` | For talent items: which counter to update. |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>updateTokenSystem</code></h4> <sup>async</sup> → <code>void</code></summary>

```js
await api.updateTokenSystem(token, data)
```

Updates system data on a token's actor. Automatically routes through the GM socket if the current user doesn't own the actor.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">token</b> | `Token` | The token whose actor to update |
| <b style="color:#e0a050">data</b> | `Object` | Update data object (e.g. `{ 'system.burn': 0, 'system.hp.value': 10 }`) |

**Example:**
```js
await api.updateTokenSystem(target, { 'system.burn': 0 });
```

</details>
