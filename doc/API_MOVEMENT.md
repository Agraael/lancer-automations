# API - Movement

[Back to API Reference](API_REFERENCE.md) · Feature guide: [Movement](feature/MOVEMENT.md)

---

## Movement Tracking

These functions accept either a string `tokenId` or a `Token` document/object.

<details>
<summary><b><code>clearMoveData</code></b> · <b><code>getCumulativeMoveData</code></b> · <b><code>getIntentionalMoveData</code></b> · <b><code>clearMovementHistory</code></b> · <b><code>getMovementHistory</code></b> · <b><code>increaseMovementCap</code></b></summary>

<br>

```js
api.clearMoveData(tokenOrId)                // wipe move history, reset cap to actor speed
api.getCumulativeMoveData(tokenOrId)        // all non-free movement -> { moved, cost }
api.getIntentionalMoveData(tokenOrId)       // player-driven drags only -> { moved, cost }
await api.clearMovementHistory(tokens, revert)   // clear history; revert=true teleports back first
api.getMovementHistory(tokenOrId)           // full breakdown (shape below)
api.increaseMovementCap(tokenOrId, value)   // add to movement cap for current turn
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>tokenOrId</kbd> | `string \| Token \| TokenDocument` | *required* | Token to read/modify (string id, `Token`, or `TokenDocument`). |
| <kbd>tokens</kbd> | `Token \| Token[]` | *required* | One token or a list, for `clearMovementHistory`. |
| <kbd>revert</kbd> | `boolean` | `false` | When true, teleport each token back through its recorded waypoints to its start position before clearing. |
| <kbd>value</kbd> | `number` | *required* | Amount added to the current-turn movement cap. |

**`clearMoveData(tokenOrId)`** deletes the token's move-history flag and re-inits its movement cap from `actor.system.speed` (0 if immobilized).

**`getCumulativeMoveData` / `getIntentionalMoveData`** both return `{ moved: number, cost: number }` (`moved` = grid distance, `cost` = movement cost with terrain penalty, falling back to `moved`). The distinction:
- **Cumulative** = every move that isn't free movement, i.e. voluntary drags **plus** involuntary/forced pushes (knockback etc.).
- **Intentional** = only player-driven drag moves (`isDrag`), excluding involuntary/forced.
- Both exclude **free** movement (the V-key hold, see [feature/MOVEMENT.md](feature/MOVEMENT.md)).

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

- **`intentional.regular` vs `intentional.free`** — intentional (drag) movement split by whether it was free. `regular` counts against the movement cap (`regularCost` is what the boost/cap detection compares to the cap); `free` is V-key free movement that ignores the cap. `total` = `regular + free`.
- **`nbBoostUsed`** — number of Boosts detected across drag moves (sum of each move's `boostSet`). Only populated when the **experimental boost detection** setting is on; a boost is counted each time intentional cost crosses a multiple of SPEED. See [MOVEMENT_ADVANCED.md](feature/MOVEMENT_ADVANCED.md).

</details>
