# API - Registration, How-Tos & Auras

[Back to API Reference](API_REFERENCE.md) · Feature guide: [Automation Engine](feature/AUTOMATION_ENGINE.md)

---

## Registration & Logic

### User Helpers

<details id="registerUserHelper">
<summary><b><code>registerUserHelper</code></b><br><b><code>getUserHelper</code></b> → <code>Function | null</code></summary>

<br>

```js
api.registerUserHelper(name, fn)   // register a shared utility function
api.getUserHelper(name)             // retrieve it by name
```

Shares logic between activation scripts.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>name</kbd> | `string` | Unique name for the helper |
| <kbd>fn</kbd> | `(...args: any[]) => any` | The function to register |

```js
api.registerUserHelper('isOverheated', (actor) => actor.system.heat.value >= actor.system.heat.max);
const isOverheated = api.getUserHelper('isOverheated');
```

</details>

---

### Registration Functions

<details id="registerDefaultItemReactions">
<summary><b><code>registerDefaultItemReactions</code></b> → <code>void</code><br><b><code>registerDefaultGeneralReactions</code></b> → <code>void</code></summary>

<br>

```js
api.registerDefaultItemReactions(reactions)      // object mapping item LIDs to activation groups
api.registerDefaultGeneralReactions(reactions)   // object mapping names to groups or single entries
```

Item reactions only fire for tokens carrying that LID. General reactions fire for every token.

Item entries must be **groups**, `{ reactions: [ ... ] }`. The engine reads `entry.reactions` without a guard,
so a bare activation object throws. General entries may be flat.

```js
api.registerDefaultItemReactions({
    "mw_my_weapon": {
        category: "System",
        itemType: "mech_weapon",
        reactions: [{
            name: "My Reaction",
            triggers: ["onActivation"],
            activationType: "code",
            activationCode: async (triggerType, data, reactor, item, activationName, api) => { }
        }]
    }
});
```

</details>

---

### How-To: Register Activations

```javascript
Hooks.on('lancer-automations.ready', (api) => {
    api.registerDefaultGeneralReactions({
        "Custom Reaction": {
            triggers: ["onDamage"],
            evaluate: (triggerType, data, reactor, item, name, api) => data.target?.id === reactor.id,
            activationCode: async (triggerType, data, reactor, item, name, api) => {
                // ... logic
            }
        }
    });
});
```

---

### How-To: Advanced Consumption

**Shared Shield Charges:**
```javascript
await api.applyEffectsToTokens({
    tokens: [target],
    effectNames: ["resistance_kinetic", "resistance_energy"]
}, {
    stack: 3,
    consumption: {
        trigger: "onDamage",
        originId: target.id,
        grouped: true
    }
});
```

---

### How-To: Bonus on One Action's Check

The bonus only ever applies to one check, so a cancelled roll leaves nothing behind. A stat roll is built on an
actor and carries no item of its own, so stamp the action that caused it, then gate the bonus on that stamp.

**Stamp the roll:**
```javascript
await api.openHaseContestCard({
    tokenA: reactorToken,
    skillA: "SYS",
    tokenB: targetToken,
    skillB: "AGI",
    title: "SEARCH - SYSTEMS vs AGILITY",
    sourceAction: "Search"
});
```

**Gate the bonus on it:**
```javascript
onInit: async function (token, item, api) {
    await api.ensureLinkedBonus({
        items: [item],
        bonusData: {
            id: `perceptive-${item.id}`,
            name: "Perceptive",
            type: "accuracy",
            val: 1,
            rollTypes: ["stat_roll"],
            condition: (state) => state?.la_extraData?.sourceAction === "Search"
        },
        addOptions: { duration: 'constant' }
    });
}
```

`executeContestedCheck` and `openHaseContestCard` take `sourceItem` / `sourceAction` in their options.
`executeStatRoll` takes `sourceItemUuid` / `sourceAction` inside its `extraData` argument instead. Either way
both surface on `onInitCheck` / `onCheck` as `item` / `actionName`.

---

### How-To: Extra Movement

Two shapes, and picking the wrong one leaks. A **standing** bonus lengthens every move of that kind for as long
as it exists:

```javascript
await api.addConstantBonus(actor, {
    id: `nerveweave-${item.id}`,
    name: "Nerveweave",
    type: "movement_extra",
    subtype: "boost",
    val: 2
});
```

A **one-shot** binds to a single move, so boosting twice does not repeat it:

```javascript
api.recordMovementExtra(reactorToken, api.tokenSpeed(reactorToken), { leg: 'boost' });
```

`leg` is `'standard'`, `'boost'` or `'current'`, and defaults to `'current'`, the granted leg the spent distance
sits in. `'boost'` lands on the Boost already taken this turn, or waits for the next one if none has been. Both
feed the ruler bands and the movement cap, so the yellow band and the cap move together.

---

## Grid-Aware Auras Wrapper

Requires the [Grid-Aware Auras](https://github.com/Wibble199/FoundryVTT-Grid-Aware-Auras) module (or [my fork](https://github.com/Agraael/FoundryVTT-Grid-Aware-Auras)).

<details id="createAura">
<summary><b><code>createAura</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code></summary>

<br>

```js
await api.createAura(owner, auraConfig)
```

Wrapper accepts a JS `function` in place of a macro ID. That form needs libWrapper installed and active. Without
it the callback silently never runs.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>owner</kbd> | `Token\|TokenDocument\|Item` | The document that owns the aura. An Item owner ties the aura to the item's lifetime |
| <kbd>auraConfig</kbd> | `Object` | Full Grid-Aware Auras configuration object |

Whenever an owning actor and token can be resolved, the wrapper deep-merges a default config underneath yours, so
a five-line call still comes out looking like the module's own auras. The defaults: one `unified` aura named
`lancer-automations-aura`, an animated dashed stroke (`lineType: 2`, width 2, 5/5 dashes), a `fillType: 2` fill at
`fillOpacity: 0.15` with the templatemacro hatching texture when that module is installed, owner visibility on,
and non-owner visibility on only when the owner's disposition is FRIENDLY. `fillColor` comes from token-factions,
or failing that the actor's folder color, and only while the owner still has a reaction available. Otherwise it
stays white. Any key you pass wins over its default.

**`macros` Function Example:**
```javascript
macros: [{
    mode: "ENTER_LEAVE",
    function: (token, parent, aura, options) => {
        if (options.hasEntered) console.log(`${token.name} entered the aura!`);
    }
}]
```

<details>
<summary><b>Available Trigger Modes</b></summary>

| Category | Modes |
|:---------|:------|
| **Macro** | `ENTER_LEAVE`, `ENTER`, `LEAVE`, `PREVIEW_ENTER_LEAVE`, `PREVIEW_ENTER`, `PREVIEW_LEAVE`, `OWNER_TURN_START_END`, `OWNER_TURN_START`, `OWNER_TURN_END`, `TARGET_TURN_START_END`, `TARGET_TURN_START`, `TARGET_TURN_END`, `ROUND_START_END`, `ROUND_START`, `ROUND_END`, `TARGET_START_MOVE`, `TARGET_END_MOVE` |
| **Effect** | `APPLY_WHILE_INSIDE`, `APPLY_ON_ENTER`, `APPLY_ON_LEAVE`, `APPLY_ON_OWNER_TURN_START`, `APPLY_ON_OWNER_TURN_END`, `APPLY_ON_TARGET_TURN_START`, `APPLY_ON_TARGET_TURN_END`, `APPLY_ON_ROUND_START`, `APPLY_ON_ROUND_END`, `REMOVE_WHILE_INSIDE`, `REMOVE_ON_ENTER`, `REMOVE_ON_LEAVE`, `REMOVE_ON_OWNER_TURN_START`, `REMOVE_ON_OWNER_TURN_END`, `REMOVE_ON_TARGET_TURN_START`, `REMOVE_ON_TARGET_TURN_END`, `REMOVE_ON_ROUND_START`, `REMOVE_ON_ROUND_END` |

</details>

```js
await api.createAura(reactorToken, {
    name: 'Suppression',
    radius: 3,
    lineWidth: 3,
    lineColor: '#ffd600',
    lineOpacity: 0.9
});
```

</details>

<details id="ensureAura">
<summary><b><code>ensureAura</code></b> <sup>async</sup> → <code>Promise&lt;any | null&gt;</code></summary>

<br>

```js
await api.ensureAura(owner, auraConfig)
```

`createAura` that no-ops when the owner already has an aura with that `name`, returning `null` instead of a second copy. The `onInit` way to add an aura: safe to run on every init without a hand-written guard.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>owner</kbd> | `Token\|TokenDocument\|Item` | The document that owns the aura |
| <kbd>auraConfig</kbd> | `Object` | Same shape as `createAura`. `name` is required |

```js
await api.ensureAura(token, { name: 'Suppression', radius: 3 });
```

</details>

<details id="deleteAuras">
<summary><b><code>deleteAuras</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code></summary>

<br>

```js
await api.deleteAuras(owner, filter, options)
```

Deletes the owner's auras and their function callbacks.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>owner</kbd> | `Token\|TokenDocument\|Item` | *required* | The document that owns the auras |
| <kbd>filter</kbd> | `string\|Object` | *required* | String ID, name, or Object filter |
| <kbd>options</kbd> | `Object` | see below | Internal Grid-Aware Auras delete options |

A non-Item owner defaults to `{ includeItems: true }`, so the sweep also removes auras owned by that actor's items. An Item owner defaults to `{}`. Anything you pass overrides the default.

```js
await api.deleteAuras(token, 'Suppression');
```

</details>

<details id="toggleAura">
<summary><b><code>toggleAura</code></b> <sup>async</sup> → <code>boolean | null</code></summary>

<br>

```js
await api.toggleAura(actorOrToken, auraName, on?)
```

Flips or sets the `enabled` flag in the actor's `grid-aware-auras.auras` flag. Does not create or delete the aura.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actorOrToken</kbd> | `Actor\|Token\|TokenDocument` | *required* | Owner of the aura |
| <kbd>auraName</kbd> | `string` | *required* | Name of the aura to toggle |
| <kbd>on</kbd> | `boolean` | `undefined` | `true` forces enable, `false` forces disable. Omit to flip the current state. |

Returns the new `enabled` state (`true`/`false`), or `null` if no aura with that name exists on the actor.

Only the actor flag is read, so an aura created with an Item owner is invisible here and always returns `null`. Delete and recreate those instead.

**Examples:**
```js
await api.toggleAura(token, "Bulwark");
await api.toggleAura(token, "Bulwark", true);
await api.toggleAura(token, "Bulwark", false);
```

</details>

<details id="gridScale">
<summary><b><code>gridScale</code></b> → <code>number</code><br><b><code>scaleAuraStroke</code></b> → <code>object</code></summary>

<br>

```js
api.gridScale()             // scene grid size relative to a 100 px baseline
api.scaleAuraStroke(aura)   // scales the config's stroke fields in place, returns it
```

Aura widths are in pixels, so a config authored on a 100 px grid draws too thin on a larger one. `scaleAuraStroke` multiplies `lineWidth`, `lineDashSize`, `lineGapSize` and `fillTextureScale` by `gridScale()`, with a floor of 1.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>aura</kbd> | `Object` | Aura config. Mutated, and returned for chaining |

```js
await api.createAura(token, api.scaleAuraStroke({ name: 'Suppression', radius: 3, lineWidth: 3 }));
```

</details>

---

## Sequencer Presets

Requires [Sequencer](https://foundryvtt.com/packages/sequencer). Used through Sequencer's `.preset()`, not through `api`.

<details id="la_scaleToBurst">
<summary><b><code>la_scaleToBurst</code></b> → <code>EffectSection</code></summary>

<br>

```js
.preset("la_scaleToBurst", burst, source)
```

Sizes an effect to a Burst around its source, in grid units: `size * 2 * (burst + 1)`. `size` is the actor's Lancer size (`system.stats.size` on deployables). `.atLocation()` must come first.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>burst</kbd> | `number` | `1` | Burst value. `0` is the token itself |
| <kbd>source</kbd> | `Token\|TokenDocument\|Actor` | `null` | Only for `atLocation(..., { cacheLocation: true })`, where the section's source is unreadable |

```js
new Sequence()
    .effect()
        .file("jb2a.lava_spout.001.001.complete.orangeyellow")
        .atLocation(token)
        .preset("la_scaleToBurst", 1)
    .play();
```

</details>
