# Vision

[← Back to Home](../index.md)

Lancer has no fog of war or vision, but these tools bring Foundry vision closer to Lancer's rules: line of sight sampled from the token's edge, tokens that block sight, and Sensor / Battlefield Awareness detection modes. Line of sight is blocked by walls. The tools work best with fog of war and token vision turned on, though sight-blocking tokens work fine without it. If you'd rather have the whole map explored from the start, my tiny [Reveal Fog Of War](https://github.com/Agraael/VTT_revealFogOFWar_V12) module adds a GM button that does it for the current scene, for all players.

> [!WARNING]
> **Get a good grasp of [Foundry's lighting system](https://foundryvtt.com/article/lighting/) before you try to set this up.** Everything here builds on it, so walls, token vision and fog of war should already make sense to you.

---

## Settings

The **Vision** tab.

<img src="../img/vis-settings.png" width="70%"/>

---

## Lancer line of sight

<img align="right" src="../vid/vis-los.gif" width="45%"/>

**`lancerLos`** emulates Lancer's line-of-sight rules in full: a token behind a wall stays visible if another token can see it. It's more accurate than Terrain Height Tools' (THT) own line of sight. It feeds the rest of the module too, [range previews](#range-pulse-line-of-sight) and automation included.

It reads Foundry walls, never THT terrain directly. [Tokens that block sight](#token-blocks-line-of-sight), Bulwark included, count as walls too.

From code, [`hasLineOfSight`](../API_SPATIAL.md#line-of-sight) runs the same test.

<br clear="right"/>

### Setup

1. Turn on **`lancerLos`** in the Vision tab. Nothing below applies without it.
2. Give the scene walls. No walls, nothing blocks. Place them by hand, generate them with [Terrain Height Tools](https://github.com/Wibble199/FoundryVTT-Terrain-Height-Tools), or use the auto wall generation in [my fork](https://github.com/Agraael/FoundryVTT-Terrain-Height-Tools).
3. Decide which walls count. By default LA reads walls that block Sight **and** any wall flagged **Blocks LA Line of Sight**. **`lancerLosFlagOnly`** narrows that to flagged walls only, so you can wall a map for gameplay without blocking vision and light. See [LA-only walls](#la-only-walls).
4. Pick a height rule with **`lancerLosHeightRule`**. It changes results more than anything else here.
    - **Discrete** follows the size rules.
    - **Trigonometric** follows the real sightline, so peeks over walls fade with distance. It can also draw [Trig shadows](#trig-shadows).
5. Check the result with **Line of sight debug overlay** (**`lancerLosDebug`**, Debug tab), which draws every tested sightline from the controlled tokens. It's heavy, leave it off in play.

### Trig shadows

**Trig shadows** (**`lancerLosTrigShadows`**) is in the Experimental section, off by default, and works with the Trigonometric height rule only.

- The ground a low wall hides from your token becomes fog.
- It only draws when a single token is viewing.
- **Trig shadow quality** (**`lancerLosTrigShadowQuality`**, per client, High by default) sets how fine the shadows are. Finer edges mean slower updates.
- The shadows can trail a moment behind a move or a new selection.

<img src="../vid/vis-trig-shadows.gif" width="70%"/>

---

## LA-only walls

A wall can be flagged **Blocks LA Line of Sight** in its Wall Config. It then blocks Lancer line of sight, targeting and range previews without blocking Foundry vision, light or fog, whatever its Sight setting. **`lancerLosFlagOnly`** goes further: LA line of sight uses only flagged walls and ignores every other wall.

Together they let you wall a map for Lancer play without the vision and light blocking that regular walls bring. The easiest setup is [my THT fork](https://github.com/Agraael/FoundryVTT-Terrain-Height-Tools): terrain types get an **LA line of sight only** option on their auto walls, and shape conversion can set the flag on the walls it creates. Tokens have the same option, **Blocks LA Line of Sight Only** in their Token Config Vision tab.

---

## Where line of sight shows

- **Attack cards**: **`lancerLosAttackHover`** draws Lancer line of sight when you hover a target, in place of THT's own ruler.
- **[Advanced Measure](./ATTACK_TARGETING.md#advanced-measure-tool)**: the eye tool, on your marks or on your targets when nothing is marked.
- **Range pulses**: see [range pulse line of sight](#range-pulse-line-of-sight).

---

## Reading the sightlines

<img src="../img/vis-sightlines.png" width="70%"/>

| Line | Meaning |
|:--|:--|
| **Green** | A clear line from viewer to target. |
| **Red** | Blocked, cut at the point that blocks it. |
| **Yellow** | Valid, but the direct sightlines are blocked and only a partial view gets through. |

Icons along a line mark what it crosses: terrain (THT), auras (Grid Aware Auras) and templates (Template Macro).

---

## Range pulse line of sight

**`rangePulseLos`** (on by default) clips every range pulse (targeting, pickers, deploy, zones, Advanced Measure, hover previews) to what its origin token can see, with the same wall rules as Lancer line of sight. Arcing / Seeking weapons stay unclipped. Each pulse gets a **Line of sight** toggle, and the interactive tools take a `los` option.

---

## Vision from edge

<img align="right" src="../img/vis-from-edge.png" width="45%"/>

Vanilla Foundry checks line of sight from a token's center. **`visionFromEdgeEnabled`** (Experimental section, off by default) checks it from the corners of the token's shape instead, so a large token can see and be seen around a corner.

- Per token: **Default**, **On** or **Off** in the Token Config Vision tab.
- Keep the token's vision angle at 360°. Under 360°, narrow gaps between walls only let thin slices of sight through.
- **Sample Offset (px)** (**`visionFromEdgeSampleOffset`**, -50 to 50) moves the corners off the token edge. Positive pushes them out, negative pulls them in.
- With Wall Height, the samples respect elevation barriers.
- **Vision From Edge Overlay** (**`visionFromEdgeDebug`**, Debug tab, per client) draws the sample points on the canvas.

<br clear="right"/>

---

## Token blocks line of sight

<img align="right" src="../img/vis-blocks-los.png" width="45%"/>

A token can be set to **block line of sight** around its bounding box, from a checkbox in its Token Config Vision tab. The **Bulwark** status turns this on automatically (`bulwarkBlocksLineOfSight`). It blocks even with token vision off.

With **Wall Height** installed it's elevation-aware: a token can see over another of the **same height** but not over a taller one.

<br clear="right"/>

---

## Token height (Wall Height)

For the elevation-aware blocking above to work, tokens need a height. **Auto Token Height (Wall Height)** (`autoTokenHeight`, on by default) sets each token's Wall-Height height to its size, so it peeks over walls and tokens of its own size. The setting is in the Vision tab under **Token Height (Wall Height)**.

**Vehicle & Squad Height Adjustments** (`autoTokenHeightVehicleSquad`) lowers that for vehicles and squads (my own interpretation of their heights, not an official rule), and the **Apply Token Heights to All Actors** button writes it onto every existing actor and token at once.

---

## Lancer vision modes

<img align="right" src="../img/vis-modes.png" width="45%"/>

Two detection modes, auto-added to tokens on creation (`lancerVisionAutoAdd`):

- **Sensors**: blue scanlines, ranged to the actor's `sensor_range`, a precise read of who's on sensors.
- **Battlefield Awareness**: a fuzzy yellow silhouette at infinite range, for "you know something's there."

When both could see a target, **Sensors win**. Either can be limited to combat (**Sensor: Combat Only** / **Awareness: Combat Only**, `lancerSensorCombatOnly` / `lancerAwarenessCombatOnly`, off by default), and either can read its range from the token's detection-mode entry (`...UseModeRange`).

A per-token **Detection Visual** (Token Config **L.A** tab) sets how a token reads: **Default**, **Simple Object**, **Visible**, or **Ignore**. Any non-default also turns Sensors off for it.

**Battlefield Awareness: style** (`lancerAwarenessStyle`) sets how much of the token the overlay covers:

- **Translucent**: silhouette at partial opacity, the default.
- **Silhouette**: solid black body.
- **Outline only**: contour and sweep, no body. A contact outside your vision shows nothing inside it.

The sweep rides the contour in every style. Per-token **Detection Visual** still wins over it.

**`basicSightTo999`** gives new tokens full basic sight, and **Refresh Tokens** re-applies the modes across scenes and actors.

<br clear="right"/>

---

## Drag vision

While a token is dragged, its vision can be shrunk so you don't reveal new map as you move. **`dragVisionMode`** picks how:

- **Full** (default): keeps it.
- **Scaled**: multiplies the radius by **`dragVisionMultiplier`** (1 = full, 0 = none).
- **Capped**: uses **`dragVisionMultiplier`** as a flat range.

---

## Performance

Recomputing vision is expensive. These settings ease that on busy scenes:

- **`visionAnimationThrottleFps`** caps how often vision and light refresh while a token is moving (0 = vanilla). It defaults to 30 FPS.
- **Drag Vision Refresh Rate** (**`dragVisionRefreshFps`**, per client) caps how often vision, lighting and auto-walls update while you drag a token (0 = every step). It defaults to 30 FPS.
- **Tactical Distance Update Rate** (**`tacticalDistanceThrottleFps`**, per client) caps how often distance labels update while you drag (0 = every frame). It defaults to 30 FPS.
- **Disable Vision Above N Controlled Tokens** (**`disableVisionAboveControlled`**) turns token vision off while more than N tokens are selected at once (0 = never), so batch-selecting doesn't recompute every token's sight. It defaults to 5, so it's already doing that.

## Notable options

| Option | What it does |
|:--|:--|
| **Sensor: Use Mode Range** | Use the per-token detection-mode range instead of the actor sensor range. |
| **Awareness: Use Mode Range** | Use the per-token detection-mode range instead of infinite. |
| **Blinded reduces vision** | While Blinded, a token sees only one space. |
