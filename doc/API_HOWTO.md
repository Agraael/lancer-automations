# API — Registration, How-Tos & Auras

[Back to API Reference](API_REFERENCE.md)

---

## Registration & Logic

### User Helpers

<details>
<summary><b><code>registerUserHelper</code></b> · <b><code>getUserHelper</code></b> → <code>Function | null</code></summary>

<br>

```js
api.registerUserHelper(name, fn)   // register a shared utility function
api.getUserHelper(name)             // retrieve it by name
```

Useful for sharing logic between separate activation scripts.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>name</kbd> | `string` | Unique name for the helper |
| <kbd>fn</kbd> | `Function` | The function to register |

</details>

---

### Registration Functions

<details>
<summary><b><code>registerDefaultItemReactions</code></b> · <b><code>registerDefaultGeneralReactions</code></b></summary>

<br>

```js
api.registerDefaultItemReactions(reactions)     // object mapping LIDs to activation objects
api.registerDefaultGeneralReactions(reactions)   // object mapping names to activation objects
```

- **Item reactions** are tied to specific item LIDs — the reaction only fires for tokens that have that item.
- **General reactions** are global — they fire for all tokens regardless of items.

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

<details>
<summary><b><code>createAura</code></b> <sup>async</sup></summary>

<br>

```js
await api.createAura(owner, auraConfig)
```

Creates an aura using the Grid-Aware Auras module. This wrapper supports passing a Javascript `function` instead of a macro ID.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>owner</kbd> | `Token\|Item` | The document that owns the aura |
| <kbd>auraConfig</kbd> | `Object` | Full Grid-Aware Auras configuration object |

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

</details>

---

<details>
<summary><b><code>deleteAuras</code></b> <sup>async</sup></summary>

<br>

```js
await api.deleteAuras(owner, filter, options)
```

Deletes auras from the specified owner. Safely cleans up any associated lambda callbacks from memory.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>owner</kbd> | `Token\|Item` | *required* | The document that owns the auras |
| <kbd>filter</kbd> | `string\|Object` | *required* | String ID, name, or Object filter |
| <kbd>options</kbd> | `Object` | `{}` | Internal Grid-Aware Auras delete options |

</details>
