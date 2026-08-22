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

To find the tokens themselves rather than measure a known pair, use `getTokensInRange`.

<details id="getTokenDistance">
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

```js
const dist = api.getTokenDistance(reactorToken, moverToken);
if (dist > 3) return false;
```

</details>

<details id="getMinGridDistance">
<summary><b><code>getMinGridDistance</code></b> → <code>number</code></summary>

<br>

```js
api.getMinGridDistance(token1, token2, overridePos1, includeElevation)
```

Minimum cell-to-cell grid distance across all occupied cell pairs.

With `includeElevation`, the grid-space elevation difference is added to the planar distance (1 horizontal + 2 vertical = 3). Default ignores it.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>token1</kbd> | `Token` | *required* | First token |
| <kbd>token2</kbd> | `Token` | *required* | Second token |
| <kbd>overridePos1</kbd> | `{ x: number; y: number }` | `null` | Evaluate as if token1 were at this world position |
| <kbd>includeElevation</kbd> | `boolean` | `false` | If `true`, add `\|elevation1 − elevation2\|` (in grid spaces) to the planar result |

```js
const planar = api.getMinGridDistance(tokenA, tokenB);
const withElevation = api.getMinGridDistance(tokenA, tokenB, null, true);
```

</details>

<details id="getGridDistance">
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

```js
const spaces = api.getGridDistance(token.center, { x: 1200, y: 800 });
```

</details>

<details id="getTokensInRange">
<summary><b><code>getTokensInRange</code></b> → <code>Token[]</code></summary>

<br>

```js
api.getTokensInRange(origin, options)
```

Tokens within `range` spaces of a token or a world point, nearest first. Size-aware on both ends. `range: 1` is adjacency.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>origin</kbd> | `Token` or `{ x, y, elevation? }` | *required* | Measured from every cell of the token, or from the point's cell |
| <kbd>range</kbd> | `number` or `'sensors'` | `1` | Spaces; `'sensors'` reads the origin actor's sensor range |
| <kbd>disposition</kbd> | `'friendly'` \| `'hostile'` | any | Faction-correct, Token Factions aware |
| <kbd>includeSelf</kbd> | `boolean` | `false` | |
| <kbd>includeHidden</kbd> | `boolean` | `false` | |
| <kbd>includeDefeated</kbd> | `boolean` | `false` | Structure or stress at 0 |
| <kbd>includeDeployables</kbd> | `boolean` | `true` | |
| <kbd>engageable</kbd> | `boolean` | `false` | Also apply `canEngage`: hostile, non-deployable, no `hidden`/`disengage`/`intangible`, no provoke immunity |
| <kbd>includeElevation</kbd> | `boolean` | `count3DDistance` setting | A point origin is always elevation-aware |
| <kbd>filter</kbd> | `(token) => boolean` | `null` | |

A point origin ignores `disposition`, `engageable` and `includeSelf`.

```js
const adjacent = api.getTokensInRange(reactorToken);
const engaged = api.getTokensInRange(reactorToken, { engageable: true });
const allies = api.getTokensInRange(reactorToken, { range: 3, disposition: 'friendly' });
const nearBlast = api.getTokensInRange(template.center, { range: 2 });
```

</details>

<details id="getEngagedTokens">
<summary><b><code>getEngagedTokens</code></b> → <code>Token[]</code></summary>

<br>

```js
api.getEngagedTokens(token, options)
```

The tokens `token` is engaged with. Empty unless `token` itself carries the `engaged` status; the returned tokens carry it too. The status is read from both the flagged effect and the actor status, so GM-applied ones count.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>token</kbd> | `Token` | *required* | The engaged token to measure from |
| <kbd>includeElevation</kbd> | `boolean` | `count3DDistance` setting | |
| <kbd>filter</kbd> | `(token) => boolean` | `null` | |

Range and `engageable` are fixed: engagement is adjacency plus `canEngage`, so deployables, dead mechs, and anything `hidden` / `disengage` / `intangible` never appear.

```js
const engaged = api.getEngagedTokens(targetToken);
const others = api.getEngagedTokens(targetToken, { filter: t => t.id !== attackerToken.id });
```

</details>

<details id="getTokenPosition">
<summary><b><code>getTokenPosition</code></b> → <code>{ x, y, elevation }</code><br><b><code>samePosition</code></b> → <code>boolean</code></summary>

<br>

```js
api.getTokenPosition(tokenLike)   // → { x, y, elevation }
api.samePosition(a, b)            // same x / y / elevation
```

Snapshot a token's position and compare it later ("has it moved since?"). `tokenLike` is a Token or TokenDocument; `a`/`b` are position objects.

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

<details id="hasLineOfSight">
<summary><b><code>hasLineOfSight</code></b> → <code>boolean</code></summary>

<br>

```js
api.hasLineOfSight(refA, refB)
```

True if `refA` has a clear Lancer line of sight to `refB`. Reciprocal: if A sees B, B sees A. Each argument is a `Token`, `TokenDocument`, or token id. Returns `false` if either can't be resolved.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>refA</kbd> | `Token \| TokenDocument \| string` | Token, document, or id |
| <kbd>refB</kbd> | `Token \| TokenDocument \| string` | Token, document, or id |

```js
if (!api.hasLineOfSight(reactorToken, targetToken)) return false;
```

</details>

---

## Faction & Disposition

<details id="isHostile">
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

```js
if (!api.isHostile(reactorToken, moverToken)) return false;
```

</details>

<details id="canProvokeReaction">
<summary><b><code>canProvokeReaction</code></b> → <code>boolean</code></summary>

<br>

```js
api.canProvokeReaction(triggering, reactor, reasonOut?)
```

`false` when the triggering token cannot provoke: it is `hidden`, took `disengage`, carries the `provoke` immunity, or is `intangible` while the reactor is not. A token paired with itself always provokes. This is the same gate the engine applies before offering a reaction, exposed for your own filters.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>triggering</kbd> | `Token` | *required* | The token that would provoke |
| <kbd>reactor</kbd> | `Token` | *required* | The token that would react |
| <kbd>reasonOut</kbd> | `Object` | `null` | Filled with why it was blocked |

```js
const reason = {};
if (!api.canProvokeReaction(moverToken, reactorToken, reason))
    console.log(reason);
```

</details>

<details id="isFriendly">
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

```js
const allies = canvas.tokens.placeables.filter(t => api.isFriendly(casterToken, t));
```

</details>

<details id="getRelativeDisposition">
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

```js
const hostile = api.getRelativeDisposition(viewerToken, otherToken) === CONST.TOKEN_DISPOSITIONS.HOSTILE;
```

</details>

---

## Grid & Cell Data

<details id="getTokenCells">
<summary><b><code>getTokenCells</code></b> → <code>Array&lt;[row, col]&gt;</code></summary>

<br>

```js
api.getTokenCells(token)
```

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token` | The token to inspect |

```js
const occupied = new Set(api.getTokenCells(token).map(([row, col]) => `${col},${row}`));
```

</details>

<details id="getMaxGroundHeightUnderToken">
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

```js
const tht = game.modules.get("terrain-height-tools")?.api;
const ground = api.getMaxGroundHeightUnderToken(token, tht);
```

</details>

<details id="triggerDangerousZoneFlow">
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

> Designed for Pilot/Mech actors. NPCs do not have a direct `system.eng` and the flow returns silently.

</details>

---

## Debug Visualizations

<details id="drawThreatDebug">
<summary><b><code>drawThreatDebug</code></b><br><b><code>drawDistanceDebug</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.drawThreatDebug(token)    // Draws threat range cells on canvas. Hex grids only.
await api.drawDistanceDebug()       // Select 2 tokens, draws shortest distance line.
```

**Params:** <kbd>token</kbd> `Token`

```js
await api.drawThreatDebug(canvas.tokens.controlled[0]);
```

</details>

<details id="drawRangeHighlight">
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

```js
const gfx = api.drawRangeHighlight(casterToken, 5, 0xff6400, 0.15);
gfx.destroy();
```

</details>
