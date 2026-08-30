# API - Movement

[Back to API Reference](API_REFERENCE.md) · Feature guide: [Movement](feature/MOVEMENT.md)

---

## Movement Tracking

<details id="clearMoveData">
<summary><b><code>clearMoveData</code></b> → <code>void</code><br><b><code>getCumulativeMoveData</code></b> → <code>MoveSummary</code><br><b><code>getIntentionalMoveData</code></b> → <code>MoveSummary</code><br><b><code>clearMovementHistory</code></b> <sup>async</sup> → <code>void</code><br><b><code>getMovementHistory</code></b> → <code>MovementHistoryResult | { exists: false }</code><br><b><code>increaseMovementCap</code></b> → <code>void</code></summary>

<br>

```js
api.clearMoveData(tokenOrId)                // wipe move history, reset cap to actor speed
api.getCumulativeMoveData(tokenOrId)        // all non-free movement -> { moved, cost }
api.getIntentionalMoveData(tokenOrId)       // player-driven drags only -> { moved, cost }
await api.clearMovementHistory(tokens, revert)   // clear history; revert=true teleports back first
api.getMovementHistory(tokenOrId)           // full breakdown (shape below)
api.increaseMovementCap(tokenOrId, value)   // add spaces to the leg being spent right now
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>tokenOrId</kbd> | `string \| Token \| TokenDocument` | *required* | Token to read/modify (string id, `Token`, or `TokenDocument`). |
| <kbd>tokens</kbd> | `Token \| Token[]` | *required* | One token or a list, for `clearMovementHistory`. |
| <kbd>revert</kbd> | `boolean` | `false` | When true, teleport each token back through its recorded waypoints to its start position before clearing. |
| <kbd>value</kbd> | `number` | *required* | Amount added to the current-turn movement cap. |

**`clearMoveData(tokenOrId)`** deletes the token's move-history flag and re-inits its movement cap from `actor.system.speed` (0 if immobilized).

**`getCumulativeMoveData` / `getIntentionalMoveData`** both return `{ moved: number, cost: number }` (`moved` = grid distance, `cost` = movement cost with terrain penalty, falling back to `moved`).
- **Cumulative** = every move that isn't free movement, i.e. voluntary drags **plus** involuntary/forced pushes (knockback etc.).
- **Intentional** = only player-driven drag moves (`isDrag`), excluding involuntary/forced.
- Both exclude **free** movement (the V-key hold, see [Movement](feature/MOVEMENT.md)).

**`getMovementHistory(tokenOrId)`** returns:
```js
{
    exists: boolean,          // false when there's no movement; then only { exists: false } is returned
    totalMoved: number,
    totalCost: number,
    intentional: { total: number, regular: number, free: number, totalCost: number, regularCost: number, freeCost: number },
    unintentional: number,
    unintentionalCost: number,
    nbBoostUsed: number,
    startPosition: { x, y },
    movementCap: number   // max movement this turn (0 if immobilized)
}
```

- **`intentional.regular` vs `intentional.free`**: drag movement split by whether it was free. `regular` counts against the movement cap (`regularCost` is what the boost/cap detection compares against), `free` is V-key movement that ignores the cap. `total` = `regular + free`.
- **`nbBoostUsed`**: number of Boosts detected across drag moves (sum of each move's `boostSet`). Only populated when the **experimental boost detection** setting is on. A boost is counted each time intentional cost crosses a multiple of SPEED. See [Movement Advanced](feature/MOVEMENT_ADVANCED.md).

</details>

<details id="getMovementBands">
<summary><b><code>getMovementBands</code></b> → <code>Band[]</code><br><b><code>getMovementCap</code></b> → <code>number</code><br><b><code>recordMovementExtra</code></b> → <code>void</code><br><b><code>recordBoostCast</code></b> → <code>void</code></summary>

<br>

```js
api.getMovementBands(tokenOrId)             // [{ name, size, max, granted }, ...]
api.getMovementCap(tokenOrId)               // sum of granted bands, floored at what is spent
api.recordBoostCast(tokenOrId, speed)       // a Boost happened: grants a boost leg
api.recordMovementExtra(tokenOrId, value, { leg: 'boost' })
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>value</kbd> | `number` | *required* | Spaces to add to a leg. May be negative. |
| <kbd>leg</kbd> | `"standard" \| "boost" \| "current"` | `"current"` | Which leg receives it. |

A turn's movement is a list of **legs**, returned as cumulative bands: the standard move, one per Boost actually
taken, then previews of what is still available. `granted: true` means the token has paid for it, and only those
count toward the cap. The boost preview is emitted only while no Boost has been taken. `size` is recomputed live from speed, statuses and standing bonuses, so a mid-turn speed
change moves the bands and the cap together. The ruler colours and the boost/overcharge offer both read this.

`recordMovementExtra` targets: `'standard'` the normal move, `'boost'` the latest granted boost leg (parked for
the next one if no Boost has been taken yet), `'current'` whichever granted leg the spent distance sits in.

Use a `movement_extra` **bonus** (`subtype: "standard" | "boost"`) instead when the effect lengthens *every* leg
of that kind rather than one. `recordMovementExtra` is for one-shots like "double your speed for this boost".

</details>
