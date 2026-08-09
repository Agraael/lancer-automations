# API - Spatial & Distance Tools

[Back to API Reference](API_REFERENCE.md) · Feature guide: [Vision](feature/VISION.md)

---

## Distance Calculations

Three distance functions. All return distance in **grid spaces** (not pixels).

| Function | Input | Size-aware | Use case |
|:---------|:------|:---:|:---------|
| `getTokenDistance` | Two tokens | Yes | General token-to-token distance. Wraps `getMinGridDistance`. |
| `getMinGridDistance` | Two tokens + optional override pos + optional elevation flag | Yes | Iterates all occupied cells of both tokens, returns the shortest cell-to-cell distance. Supports hypothetical positioning via `overridePos1`. Optional `includeElevation` adds elevation difference to the planar distance. |
| `getGridDistance` | Two `{x,y}` world points | No | Raw point-to-point grid distance. Use when you have coordinates, not tokens. |

<details>
<summary><b><code>getTokenDistance</code></b> → <code>number</code></summary>

<br>

```js
api.getTokenDistance(token1, token2, includeElevation)
```

Delegates to `getMinGridDistance(token1, token2, null, includeElevation)`.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token1</kbd> | `Token` | First token |
| <kbd>token2</kbd> | `Token` | Second token |
| <kbd>includeElevation</kbd> | `boolean` | If `true`, add the grid-space elevation difference to the planar result |

</details>

---

<details>
<summary><b><code>getMinGridDistance</code></b> → <code>number</code></summary>

<br>

```js
api.getMinGridDistance(token1, token2, overridePos1, includeElevation)
```

Minimum cell-to-cell grid distance across all occupied cell pairs.

With `includeElevation`, the grid-space elevation difference is added to the planar distance (1 horizontal + 2 vertical = 3); default ignores it.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>token1</kbd> | `Token` | *required* | First token |
| <kbd>token2</kbd> | `Token` | *required* | Second token |
| <kbd>overridePos1</kbd> | `{ x: number; y: number }` | `null` | Evaluate as if token1 were at this world position |
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
| <kbd>pos1</kbd> | `{ x: number; y: number }` | World coordinates |
| <kbd>pos2</kbd> | `{ x: number; y: number }` | World coordinates |

</details>

---

## Grid Coordinate Helpers

Square + hex. "Center" points drop straight into `moveToken({ destination })`.

| Function | Returns | Purpose |
|:---------|:--------|:--------|
| `getCellToward(from, toward, { steps=1, away=false })` | `{ x, y }` center | Cell `steps` from `from` toward (or `away` from) `toward`, walking real neighbors. `from`/`toward` = Token or point. |
| `snapTokenCenter(token, center)` | `{ x, y }` top-left | Snap a center to a valid placement for the token footprint. |
| `getOccupiedCenters(token, overridePos?)` | `Array<{ x, y }>` | Centers of every cell the token occupies. |
| `getHexCenter(col, row)` | `{ x, y }` center | Cell center from a grid offset. |
| `pixelToOffset(x, y)` | `{ col, row }` | Grid offset at a world point. |
| `measureGridDistance(p1, p2)` | `number` | Grid distance between two points. |
| `neighborKeys("col,row")` | `string[]` | Adjacent cell keys (6 hex / 8 square). |

---

## Line of Sight

**Beta.** Wall-based, height-aware, reciprocal line of sight - the same test the Lancer LOS detection mode runs. Only meaningful with **Lancer Line of Sight** enabled in the [Vision tab](feature/VISION.md).

<details>
<summary><b><code>hasLineOfSight</code></b> → <code>boolean</code></summary>

<br>

```js
api.hasLineOfSight(refA, refB)
```

True if `refA` has a clear Lancer line of sight to `refB`. Reciprocal: if A sees B, B sees A. Each argument is a `Token`, `TokenDocument`, or token id; returns `false` if either can't be resolved.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>refA</kbd> | `Token \| TokenDocument \| string` | Token, document, or id |
| <kbd>refB</kbd> | `Token \| TokenDocument \| string` | Token, document, or id |

</details>

---

## Faction & Disposition

<details>
<summary><b><code>isHostile</code></b> → <code>boolean</code></summary>

<br>

```js
api.isHostile(reactor, mover)
```

Compatible with the Token Factions module.

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

Compatible with the Token Factions module.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token1</kbd> | `Token` | First token |
| <kbd>token2</kbd> | `Token` | Second token |

</details>

---

<details>
<summary><b><code>getRelativeDisposition</code></b> → <code>number|null</code></summary>

<br>

```js
api.getRelativeDisposition(viewer, other)
```

Disposition of `other` as seen from `viewer`, returned as a `CONST.TOKEN_DISPOSITIONS` value. With Token Factions active it resolves the advanced-team matrix, otherwise it falls back to `other`'s own token disposition. Use instead of `token.disposition` for faction-correct results.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>viewer</kbd> | `Token` | The reference token (perspective) |
| <kbd>other</kbd> | `Token` | The token being classified |

</details>

---

## Grid & Cell Data

<details>
<summary><b><code>getTokenCells</code></b> → <code>Array&lt;[row, col]&gt;</code></summary>

<br>

```js
api.getTokenCells(token)
```

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

<details>
<summary><b><code>triggerDangerousZoneFlow</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.triggerDangerousZoneFlow(token, damageType, damageValue)
```

Rolls an ENG check on the token's actor. On a result below 10 the token is targeted and a damage roll is performed. Dedupes to once per combat round per actor (uses an actor flag in the `lancer-automations` namespace). Outside combat, fires every call.

Body for a "dangerous terrain" trigger, e.g. a Terrain Height Tools on-enter callback:

```js
await game.modules.get("lancer-automations").api.triggerDangerousZoneFlow(token, "burn", 5);
```

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token \| TokenDocument` | Token whose actor rolls ENG and takes damage on failure |
| <kbd>damageType</kbd> | `string` | `"kinetic"`, `"energy"`, `"explosive"`, `"burn"`, `"heat"`, `"variable"`. Defaults to `"kinetic"` |
| <kbd>damageValue</kbd> | `number \| string` | Damage amount or dice expression. Defaults to `5` |

> Designed for Pilot/Mech actors; NPCs do not have a direct `system.eng` and the flow returns silently.

</details>

---

## Debug Visualizations

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
api.drawRangeHighlight(casterToken, range, color, alpha, includeSelf, opts)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>casterToken</kbd> | `Token\|{ x: number; y: number }` | *required* | Origin token or point |
| <kbd>range</kbd> | `number` | *required* | Radius in grid spaces |
| <kbd>color</kbd> | `number` | `0x00ff00` | Hex color |
| <kbd>alpha</kbd> | `number` | `0.2` | Opacity (0-1) |
| <kbd>includeSelf</kbd> | `boolean` | `false` | Include origin cells |
| <kbd>opts</kbd> | `Object` | `{}` | Extra styling: `lineAlpha`, `lineColor`, `lineWidth`, `glowColor` |

</details>
