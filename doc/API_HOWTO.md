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
api.registerDefaultItemReactions(reactions)     // object mapping LIDs to activation objects
api.registerDefaultGeneralReactions(reactions)   // object mapping names to activation objects
```

- **Item reactions** are tied to specific item LIDs - the reaction only fires for tokens that have that item.
- **General reactions** are global - they fire for all tokens regardless of items.

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

## Grid-Aware Auras Wrapper

Requires the [Grid-Aware Auras](https://github.com/Wibble199/FoundryVTT-Grid-Aware-Auras) module (or [my fork](https://github.com/Agraael/FoundryVTT-Grid-Aware-Auras)).

<details id="createAura">
<summary><b><code>createAura</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code></summary>

<br>

```js
await api.createAura(owner, auraConfig)
```

Wrapper accepts a JS `function` in place of a macro ID.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>owner</kbd> | `Token\|TokenDocument\|Item` | The document that owns the aura. An Item owner ties the aura to the item's lifetime |
| <kbd>auraConfig</kbd> | `Object` | Full Grid-Aware Auras configuration object |

See `ensureAura` below for the idempotent form.

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

`createAura` that no-ops when the owner already has an aura with that `name`, returning `null` instead of a second copy. The `onInit` way to add an aura: safe to run on every init without a hand-written guard. `auraConfig.name` is required for the dedupe.

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
| <kbd>options</kbd> | `Object` | `{}` | Internal Grid-Aware Auras delete options |

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

**Examples:**
```js
await api.toggleAura(token, "Bulwark");          // flip
await api.toggleAura(token, "Bulwark", true);    // ensure on
await api.toggleAura(token, "Bulwark", false);   // ensure off
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
