# Movement: Advanced & Beta

[← Back to the README](../../README.md) · Main guide: [MOVEMENT.md](./MOVEMENT.md)

In the **Combat & Movement** tab: boost detection, the movement cap, the boost offer, drag pathfinding, path-hex, and 3D distance under **Combat Flows**, and trigger-boundary splits under **Lancer Automations Ruler**; the debug ones are in the **Debug** tab.

> [!WARNING]
> Boost detection and the movement cap are **beta**. They change how dragging a token behaves in combat, so test them before relying on them in combat.

---

## Boost detection

**`experimentalBoostDetection`** tracks the cumulative cost of a token's intentional (dragged) movement and works out when it crosses a boost threshold. Boost N is counted once the running cost passes N times the token's speed.

When it fires, the `onMove` trigger data carries `moveInfo.isBoost` (this move crossed a threshold) and `moveInfo.boostSet` (which boost numbers were crossed). Cumulative movement resets when the move history clears (combat start, or per turn/round if you enabled those). **`debugBoostDetection`** shows a notification with the numbers each time it triggers.

---

## Movement cap and the offer cards

<img align="right" src="../img/mv-boost-offer.png" width="45%"/>

**`enableMovementCapDetection`** sets a movement cap from the token's speed when combat starts and cancels a drag that would exceed it. With **`enableBoostOffer`** also on, instead of cancelling it offers a card:

- **Boost & Move** - when one Boost would cover the overage. It moves up to the cap, fires the Boost action, then moves the rest.
- **Overcharge & Boost & Move** - for mechs (or NPCs with an Overcharge feature) when one Boost isn't enough but two are. It moves, Boosts, Overcharges, Boosts again, then finishes the move.

If neither is enough, the move is rejected with a reminder to hold the free-movement key. Choosing **Ignore** on a card runs the full move without the cap check.

<br clear="right"/>

---

## Drag pathfinding

**`pathfindDragMovement`** routes a dragged token around hostile bodies and tall terrain instead of straight through them. A live overlay shows how far it can still reach as you drag.

---

## Split movement at trigger boundaries

**`splitMovementAtTriggerBoundaries`** (also in the Lancer Automations Ruler settings) splits a drag into sub-moves at each cell where the token crosses a trigger boundary - Terrain Height Tools, TemplateMacro, Grid-Aware Auras, or a Foundry region.

The triggers then fire as the token visually reaches each boundary, instead of all at once at the end of the move. The visible path is unchanged.

On hex grids the sub-waypoints can occasionally drift the resolved path from the preview. Stabilization code softens it, but the clean fix is two hooks in Foundry's source (self-hosted only, in `resources/app/public/scripts/foundry.mjs`).

<details>
<summary><b>The two source patches</b></summary>

<br>

**1. `Token#updatePlannedMovement`** (~line 144045), after the `if (!context)` return, before `getCompleteMovementPath`:

```js
Hooks.callAll("modifyPlannedMovement", this, context);
```

Without it, LA falls back to injecting waypoints at drop time (less precise preview, still works).

**2. `TokenDocument#splitMovementPath`** (~line 54166, the `if (regionCheckpoint)` block). Match the token-anchored cell offset so an LA waypoint already on the hex suppresses Foundry's sub-pixel checkpoint (else: three dots, cube-line divergence). No fallback:

```js
if ( regionCheckpoint ) {
  let _laRC, _laPV, _laCU;
  try {
    _laRC = this._positionToGridOffset(regionCheckpoint);
    _laPV = this._positionToGridOffset(previous);
    _laCU = this._positionToGridOffset(current);
  } catch {}
  const _laSameCellPrev = !!(_laRC && _laPV && _laRC.i === _laPV.i && _laRC.j === _laPV.j);
  const _laSameCellCurr = !!(_laRC && _laCU && _laRC.i === _laCU.i && _laRC.j === _laCU.j);

  if ( (TokenDocument.arePositionsEqual(regionCheckpoint, previous) || _laSameCellPrev) && (previous !== origin) ) {
    previous.checkpoint = true;
    pending.push(current);
  }
  else if ( TokenDocument.arePositionsEqual(regionCheckpoint, current) || _laSameCellCurr ) {
    current.checkpoint = true;
    passed.push(current);
  }
```

Keep the original final `else` and closing brace as-is.

</details>

---

## Path hex calculation

**`enablePathHexCalculation`** (default on) records the exact grid cells a move passes through, which interception and trigger logic use to know what the token crossed. **`debugPathHexCalculation`** draws those cells on the canvas for a few seconds.

---

## Debug

- **`debugMovement`** logs the per-cell cost calculation and draws terrain/climb/penalty overlays on the canvas during a move.
- **`debugBoostDetection`** notifies on each boost detection (see above).
- **`debugPathHexCalculation`** highlights the calculated path cells.
