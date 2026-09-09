# API - Movement

[Back to API Reference](API_REFERENCE.md) · Feature guide: [Movement](feature/MOVEMENT.md)

---

## Movement Tracking

<details id="getMovementHistory">
<summary><b><code>getCumulativeMoveData</code></b> → <code>MoveSummary</code><br><b><code>getIntentionalMoveData</code></b> → <code>MoveSummary</code><br><b><code>getMovementHistory</code></b> → <code>MovementHistoryResult | { exists: false }</code><br><b><code>getMoveDataList</code></b> → <code>object[]</code></summary>

<br>

```js
api.getCumulativeMoveData(tokenOrId)        // all non-free movement -> { moved, cost }
api.getIntentionalMoveData(tokenOrId)       // player-driven drags only -> { moved, cost }
api.getMovementHistory(tokenOrId)           // full breakdown (shape below)
api.getMoveDataList(tokenOrId)              // raw per-move list, [] when empty
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>tokenOrId</kbd> | `string \| Token \| TokenDocument` | *required* | Token to read (string id, `Token`, or `TokenDocument`). |

**`getCumulativeMoveData` / `getIntentionalMoveData`** return `{ moved, cost }`: `moved` is grid distance, `cost` is the movement cost with terrain penalty, falling back to `moved`.
- **Cumulative** = every move that isn't free movement, i.e. voluntary drags **plus** involuntary/forced pushes (knockback etc.).
- **Intentional** = only player-driven drag moves (`isDrag`), excluding involuntary/forced.
- Both exclude **free** movement (the V-key hold, see [Movement](feature/MOVEMENT.md)).

**`getMovementHistory(tokenOrId)`** returns:
```js
{
    exists: boolean,          // false when there's no movement, and then only { exists: false } comes back
    totalMoved: number,
    totalCost: number,
    intentional: { total: number, regular: number, free: number, totalCost: number, regularCost: number, freeCost: number },
    unintentional: number,
    unintentionalCost: number,
    nbBoostUsed: number,
    startPosition: { x, y },
    movementCap: number   // same value getMovementCap returns
}
```

- **`intentional.regular` vs `intentional.free`**: drag movement split by whether it was free. `regular` counts against the movement cap (`regularCost` is what the boost/cap detection compares against), `free` is V-key movement that ignores the cap. `total` = `regular + free`.
- **`nbBoostUsed`**: number of Boost actions recorded this turn.

**`getMoveDataList`** returns the raw recorded moves the summaries above are built from, one entry per move with its flags (`isDrag`, `isFreeMovement`, cost, positions). The ruler overlay uses it to tell free and debug waypoints apart.

</details>

<details id="clearMoveData">
<summary><b><code>clearMoveData</code></b> → <code>void</code><br><b><code>clearMovementHistory</code></b> <sup>async</sup> → <code>void</code><br><b><code>increaseMovementCap</code></b> → <code>void</code><br><b><code>undoMoveData</code></b> → <code>void</code><br><b><code>initMovementCap</code></b> → <code>void</code></summary>

<br>

```js
api.clearMoveData(tokenOrId)                // wipe the move-history flag (see below)
await api.clearMovementHistory(tokens, revert)   // clear history, revert=true retraces first
api.increaseMovementCap(tokenOrId, value)   // add spaces to the leg being spent right now
api.undoMoveData(tokenOrId)                 // drop the last recorded move
api.initMovementCap(token)                  // turn reset: clear per-turn legs, re-cache the cap
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>tokenOrId</kbd> | `string \| Token \| TokenDocument` | *required* | Token to modify. |
| <kbd>tokens</kbd> | `Token \| Token[]` | *required* | One token or a list, for `clearMovementHistory`. |
| <kbd>revert</kbd> | `boolean` | `false` | When true, walk each token back to its start position first, animated along its recorded waypoints in reverse. A straight line back is only the fallback if the retrace is rejected. |
| <kbd>value</kbd> | `number` | *required* | Amount added to the current-turn movement cap. |

**`clearMoveData(tokenOrId)`** deletes the token's move-history flag. If the token is a combatant in the active combat it also re-caches the cap, re-derived from the movement bands (speed after prone halving, plus standing bonuses), and 0 while immobilized. Outside combat it only deletes the flag.

**`undoMoveData(tokenOrId)`** removes the last recorded move from the history. A Boost cast on that move is dropped with it (that is the refund, the cap is summed from what is left) and the cap is re-cached.

**`initMovementCap(token)`** is the turn reset the module runs itself: for a combatant it clears the per-turn legs (boost casts and hand adjustments) and re-caches the cap, 0 while immobilized. No-op for tokens not in combat. Call it after tampering with the history flags directly.

</details>

<details id="getMovementBands">
<summary><b><code>getMovementBands</code></b> → <code>Band[]</code><br><b><code>getMovementCap</code></b> → <code>number</code><br><b><code>tokenSpeed</code></b> → <code>number</code></summary>

<br>

```js
api.getMovementBands(tokenOrId)             // [{ name, size, max, granted }, ...]
api.getMovementCap(tokenOrId)               // granted total, floored at what is spent
api.tokenSpeed(tokenOrActor)                // speed after prone halving
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>tokenOrId</kbd> | `string \| Token \| TokenDocument` | *required* | Token to read. `tokenSpeed` also takes an `Actor`. |

A turn's movement is a list of **legs**, returned as cumulative bands. `name` is `'standard'`, `'boost'` or
`'over-boost'`: the standard move, then one band per Boost actually taken, then previews of what is still
available. `granted: true` means the token has paid for it, and only those count toward the cap. Both previews
are dropped while the token is slow or prone, and the over-boost preview also stops once two Boosts have been
taken. `size` is recomputed live from speed, statuses and standing bonuses, so a mid-turn speed
change moves the bands and the cap together. The ruler colours and the boost/overcharge offer both read this.

**`getMovementCap`** is the last granted band's `max`, floored at what the token has already spent under the cap
(drag movement that is neither free nor a cap bypass). A stop-movement status empties the bands, so the cap is 0
unless spend already floors it above that. `getMovementHistory().movementCap` is this same call, not a second number.

</details>

<details id="recordMovementExtra">
<summary><b><code>recordMovementExtra</code></b> → <code>void</code><br><b><code>recordBoostCast</code></b> → <code>void</code></summary>

<br>

```js
api.recordMovementExtra(tokenOrId, value, { leg: 'boost' })
api.recordBoostCast(tokenOrId, speed)       // a Boost happened: grants a boost leg
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>tokenOrId</kbd> | `string \| Token \| TokenDocument` | *required* | Token to modify. |
| <kbd>value</kbd> | `number` | *required* | `recordMovementExtra` only. Spaces to add to a leg. May be negative. |
| <kbd>leg</kbd> | `"standard" \| "boost" \| "current"` | `"current"` | `recordMovementExtra` only. Which leg receives it. |
| <kbd>speed</kbd> | `number` | *required* | `recordBoostCast` only. Stored on the cast entry but read nowhere: the granted leg's size is recomputed live, so this value has no effect. |

`recordMovementExtra` targets: `'standard'` the normal move, `'boost'` the latest granted boost leg (parked for
the next one if no Boost has been taken yet), `'current'` whichever granted leg the spent distance sits in.

Use a `movement_extra` **bonus** (`subtype: "standard" | "boost"`) instead when the effect lengthens *every* leg
of that kind rather than one. `recordMovementExtra` is for one-shots like "double your speed for this boost".

</details>
