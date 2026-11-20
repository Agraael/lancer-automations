# API - Spatial & Distance Tools

[Back to API Reference](API_REFERENCE.md) · Feature guide: [Vision](feature/VISION.md)

---

## Distance Calculations

Three distance functions. All return distance in **grid spaces** (not pixels).

| Function | Input | Size-aware | Use case |
|:---------|:------|:---:|:---------|
| `getTokenDistance` | Two tokens | Yes | General token-to-token distance. Wraps `getMinGridDistance`. |
| `getMinGridDistance` | Two tokens + optional override pos + optional elevation flag | Yes | Iterates all occupied cells of both tokens, returns the shortest cell-to-cell distance. Supports hypothetical positioning via `overridePos1`. With `includeElevation`, distance is `max(horizontal, elevation)`. |
| `getGridDistance` | Two `{x,y}` world points | No | Raw point-to-point grid distance. Use when you have coordinates, not tokens. |

To find the tokens themselves rather than measure a known pair, use `getTokensInRange`.

<details id="getTokenDistance">
<summary><b><code>getTokenDistance</code></b> → <code>number</code></summary>

<br>

```js
api.getTokenDistance(token1, token2, includeElevation)
```

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token1</kbd> | `Token` | First token |
| <kbd>token2</kbd> | `Token` | Second token |
| <kbd>includeElevation</kbd> | `boolean` | `true` returns `max(horizontal, elevation)`. Omit it to follow the `count3DDistance` setting |

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

With `includeElevation`, the result is `max(planar distance, elevation difference)` in grid spaces: the dominant axis wins, so 1 horizontal + 2 vertical = 2.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>token1</kbd> | `Token` | *required* | First token |
| <kbd>token2</kbd> | `Token` | *required* | Second token |
| <kbd>overridePos1</kbd> | `{ x: number; y: number }` | `null` | Evaluate as if token1 were at this world position |
| <kbd>includeElevation</kbd> | `boolean` | `count3DDistance` setting | If `true`, the planar distance competes with `\|elevation1 − elevation2\|` (in grid spaces) and the larger wins |

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
| <kbd>range</kbd> | `number` or `'sensors'` | `1` | Spaces. `'sensors'` reads the origin actor's sensor range |
| <kbd>disposition</kbd> | `'friendly'` \| `'hostile'` | any | Faction-correct, Token Factions aware |
| <kbd>includeSelf</kbd> | `boolean` | `false` | |
| <kbd>includeHidden</kbd> | `boolean` | `false` | |
| <kbd>includeDefeated</kbd> | `boolean` | `false` | Structure or stress at 0 |
| <kbd>includeDeployables</kbd> | `boolean` | `true` | |
| <kbd>engageable</kbd> | `boolean` | `false` | Also apply `canEngage`: hostile, non-deployable, structure above 0, no `hidden`/`disengage`/`intangible`, no provoke immunity |
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

The tokens `token` is engaged with. Empty unless `token` itself carries the `engaged` status, and the returned tokens carry it too. The status is read from both the flagged effect and the actor status, so GM-applied ones count.

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
<summary><b><code>getTokenPosition</code></b> → <code>{ x, y, elevation }</code><br><b><code>samePosition</code></b> → <code>boolean</code><br><b><code>isPositionChange</code></b> → <code>boolean</code></summary>

<br>

```js
api.getTokenPosition(tokenLike)   // → { x, y, elevation }
api.samePosition(a, b)            // same x / y / elevation
api.isPositionChange(change)      // an update diff moves the token
```

Snapshot a token's position and compare it later ("has it moved since?"). `tokenLike` is a Token or TokenDocument, `a`/`b` are position objects.

`getTokenPosition` returns the token's top-left corner (`doc.x` / `doc.y`), not its center. It is not a drop-in destination for `moveToken`, which expects a center point.

`isPositionChange` is true when an update diff carries `x`, `y` or `elevation`, the gate for an `onUpdate` automation. It checks that the keys are there, not that the values differ.

**Params:** <kbd>change</kbd> `Object` the update diff, `triggerData.change` on `onUpdate`

```js
if (!api.isPositionChange(triggerData.change)) return false;
```

</details>

<details id="getToken">
<summary><b><code>getToken</code></b> → <code>Token | null</code></summary>

<br>

```js
api.getToken(idOrUuid)
```

The placed Token for a token id or a token UUID (`Scene.<id>.Token.<id>`). Only tokens on the viewed scene resolve, anything else returns `null`.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>idOrUuid</kbd> | `string` | Token id or token UUID |

```js
const target = api.getToken(data.targetId);
```

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
| `measureGridDistance(p1, p2)` | `number` | Distance between two points in scene units, not grid spaces. Divide by `canvas.scene.grid.distance` for spaces, or use `getGridDistance`. |
| `neighborKeys("col,row")` | `string[]` | Adjacent cell keys (6 hex / 8 square). |

---

## Line of Sight

**Beta.** Wall-based, height-aware line of sight, the same test the Lancer LOS detection mode runs. Only meaningful with **Lancer Line of Sight** enabled in the [Vision tab](feature/VISION.md).

<details id="hasLineOfSight">
<summary><b><code>hasLineOfSight</code></b> → <code>boolean</code></summary>

<br>

```js
api.hasLineOfSight(refA, refB)
```

True if `refA` has a clear Lancer line of sight to `refB`. Each argument is a `Token`, `TokenDocument`, or token id. Returns `false` if either can't be resolved.

The wall test is reciprocal: if A sees B, B sees A. Blinded is not. With the `blindedSetsVision` setting on, a Blinded token sees adjacent spaces only, and that cuts sight for it alone, so the pair can disagree. Fails open: a token paired with itself, or a destroyed placeable, returns `true`.

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

True when one side is friendly and the other hostile. NEUTRAL counts as friendly, SECRET counts as hostile. Two hostile tokens are not hostile to each other. Compatible with the Token Factions module, which answers the question itself when active.

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

`false` when the triggering token cannot provoke: it is `hidden`, took `disengage`, carries the `provoke` immunity, or is `intangible` while the reactor is not. A token paired with itself always provokes. This is the same gate the engine applies for `requireCanProvoke`, exposed for your own filters.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>triggering</kbd> | `Token` | *required* | The token that would provoke |
| <kbd>reactor</kbd> | `Token` | *required* | The token that would react |
| <kbd>reasonOut</kbd> | `Array<string>` | `null` | Pass an array. The blocking reason is pushed onto it: `hidden`, `disengage`, `provoke_immunity` or `intangible` |

```js
const reasons = [];
if (!api.canProvokeReaction(moverToken, reactorToken, reasons) && reasons.includes('disengage'))
    console.log('mover disengaged');
```

</details>

<details id="isFriendly">
<summary><b><code>isFriendly</code></b> → <code>boolean</code></summary>

<br>

```js
api.isFriendly(token1, token2)
```

True when both sides sit on the same side of the line: both friendly, or both hostile. NEUTRAL counts as friendly, SECRET counts as hostile. Two hostile tokens are therefore friendly to each other, so this is not the inverse of `isHostile`. Compatible with the Token Factions module, which answers the question itself when active.

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

Disposition of `other` as seen from `viewer`, returned as a `CONST.TOKEN_DISPOSITIONS` value. It resolves the advanced-team matrix only when Token Factions is active **and** its "color from" setting is `advanced-factions`, the one mode that carries the full matrix. Otherwise it falls back to `other`'s own token disposition. Use instead of `token.disposition` for faction-correct results.

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

<details id="laTokenHeight">
<summary><b><code>laTokenHeight</code></b> → <code>number</code><br><b><code>laTokenGameplayHeight</code></b> → <code>number</code></summary>

<br>

```js
api.laTokenHeight(tokenDoc)
api.laTokenGameplayHeight(tokenDoc)
```

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>tokenDoc</kbd> | `TokenDocument` | The token to measure |

`laTokenHeight`: sight height (wall-height flag or SIZE + 0.1). `laTokenGameplayHeight`: the same snapped to the closest SIZE (0.5, 1, 2, 3...).

</details>

<details id="getMaxGroundHeightUnderToken">
<summary><b><code>getMaxGroundHeightUnderToken</code></b> → <code>number</code></summary>

<br>

```js
api.getMaxGroundHeightUnderToken(token, terrainAPI)
```

Highest ground top under any cell the token occupies: solid, height-using terrain (`elevation + height`) and other [solid tokens](#isSolidToken). Decorative or non-solid terrain is skipped. Returns `0` when there is nothing under it. Solid tokens count without Terrain Height Tools.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token` | The token to check |
| <kbd>terrainAPI</kbd> | `Object` | Optional. Terrain Height Tools API object, defaults to `globalThis.terrainHeightTools` |

```js
const tht = game.modules.get("terrain-height-tools")?.api;
const ground = api.getMaxGroundHeightUnderToken(token, tht);
```

</details>

<details id="getHexGroundElevation">
<summary><b><code>getHexGroundElevation</code></b> → <code>number</code><br><b><code>isHexUnderTerrain</code></b> → <code>boolean</code></summary>

<br>

```js
api.getHexGroundElevation(col, row, terrainAPI?, options?)
api.isHexUnderTerrain(col, row, elevation, terrainAPI?, excludeTokenId?)
```

`getHexGroundElevation` is the ground top of one cell: the highest solid, height-using terrain or solid token on it. `isHexUnderTerrain` is true when a solid token or solid terrain on the cell starts above `elevation`. Solid tokens count without Terrain Height Tools.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>col</kbd> / <kbd>row</kbd> | `number` | *required* | Grid offset of the cell |
| <kbd>elevation</kbd> | `number` | *required* | `isHexUnderTerrain` only. Elevation to test, in grid units |
| <kbd>terrainAPI</kbd> | `Object` | `globalThis.terrainHeightTools` | Pass `undefined` to keep the default and still give the next argument |
| <kbd>excludeTokenId</kbd> | `string` | `null` | `isHexUnderTerrain` only, 5th argument. Ignore this token's own solid band |
| **inside `options`** | | | |
| <kbd>excludeTokenId</kbd> | `string` | `null` | Ignore this token's own solid band |
| <kbd>solidTokens</kbd> | `boolean` | `true` | `false` reads terrain only |

```js
const ground = api.getHexGroundElevation(gridOffset.j, gridOffset.i, terrainAPI, { excludeTokenId: mover.id });
```

</details>

<details id="isSolidToken">
<summary><b><code>isSolidToken</code></b> → <code>boolean</code><br><b><code>solidTokenTopAt</code></b> → <code>number</code></summary>

<br>

```js
api.isSolidToken(token)
api.solidTokenTopAt(x, y, excludeTokenId?)
```

**Params:** <kbd>token</kbd> `Token|TokenDocument` · <kbd>x</kbd> / <kbd>y</kbd> `number` canvas pixels · <kbd>excludeTokenId</kbd> `string` optional

`isSolidToken` reads the token's **Solid** checkbox (Token Config, L.A tab). `solidTokenTopAt` is the highest top of a visible solid token at that point, `0` when there is none. A solid token's top is its elevation plus its [gameplay height](#laTokenHeight).

```js
const top = api.solidTokenTopAt(token.center.x, token.center.y, token.id);
```

</details>

<details id="triggerDangerousZoneFlow">
<summary><b><code>triggerDangerousZoneFlow</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.triggerDangerousZoneFlow(token, damageType, damageValue)
```

Rolls an ENG check on the token's actor. On a result below 10 the token is targeted and a damage roll is performed. Dedupes to once per combat round per actor (uses an actor flag in the `lancer-automations` namespace). Outside combat, fires every call.

If the actor is terrain-immune (the `terrain_immunity` status or a `terrain` immunity bonus), a "TERRAIN IMMUNITY" choice card goes to the GM first:

- Ignore the terrain. This consumes an immunity use when the immunity came from a bonus.
- Apply the terrain anyway and run the check.

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
<summary><b><code>drawThreatDebug</code></b> <sup>async</sup><br><b><code>drawDistanceDebug</code></b> <sup>async</sup> → <code>void</code></summary>

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
| <kbd>opts</kbd> | `Object` | `{}` | Styling: `lineAlpha`, `lineColor`, `lineWidth`, `glowColor`, `perimeterAlpha`. Also `los`, which clips the highlight to line of sight and needs the `rangePulseLos` setting, and `freeRange`, spaces around the origin the clip never removes |

```js
const gfx = api.drawRangeHighlight(casterToken, 5, 0xff6400, 0.15);
gfx.destroy();
```

</details>
