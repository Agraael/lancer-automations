<h1>API — Registration, How-Tos & Auras</h1>

[Back to API Reference](API_REFERENCE.md)

<br>

<h2>Registration & Logic</h2>

<!-- ═══════════════════════════════════════════════════════════════ -->

<h3>User Helpers</h3>

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>registerUserHelper</code></h4> · <h4 style="display:inline"><code>getUserHelper</code></h4> → <code>Function | null</code></summary>

```js
api.registerUserHelper(name, fn)   // register a shared utility function
api.getUserHelper(name)             // retrieve it by name
```

Useful for sharing logic between separate activation scripts.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">name</b> | `string` | Unique name for the helper |
| <b style="color:#e0a050">fn</b> | `Function` | The function to register |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<h3>Registration Functions</h3>

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>registerDefaultItemReactions</code></h4> · <h4 style="display:inline"><code>registerDefaultGeneralReactions</code></h4></summary>

```js
api.registerDefaultItemReactions(reactions)     // object mapping LIDs to activation objects
api.registerDefaultGeneralReactions(reactions)   // object mapping names to activation objects
```

- **Item reactions** are tied to specific item LIDs — the reaction only fires for tokens that have that item.
- **General reactions** are global — they fire for all tokens regardless of items.

</details>

<br>

<!-- ═══════════════════════════════════════════════════════════════ -->

<h3>How-To: Register Activations</h3>

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

<br>

<!-- ═══════════════════════════════════════════════════════════════ -->

<h3>How-To: Advanced Consumption</h3>

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

<br>

<h2>Grid-Aware Auras Wrapper</h2>

Requires the [Grid-Aware Auras](https://github.com/Wibble199/FoundryVTT-Grid-Aware-Auras) module (or [my fork](https://github.com/Agraael/FoundryVTT-Grid-Aware-Auras)).

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>createAura</code></h4> <sup>async</sup></summary>

```js
await api.createAura(owner, auraConfig)
```

Creates an aura using the Grid-Aware Auras module. This wrapper supports passing a Javascript `function` instead of a macro ID.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">owner</b> | `Token\|Item` | The document that owns the aura |
| <b style="color:#e0a050">auraConfig</b> | `Object` | Full Grid-Aware Auras configuration object |

**`macros` Function Example:**
```javascript
macros: [{
    mode: "ENTER_LEAVE",
    function: (token, parent, aura, options) => {
        if (options.hasEntered) console.log(`${token.name} entered the aura!`);
    }
}]
```

<details><summary><b>Available Trigger Modes</b></summary>

| Category | Modes |
|:---------|:------|
| **Macro** | `ENTER_LEAVE`, `ENTER`, `LEAVE`, `PREVIEW_ENTER_LEAVE`, `PREVIEW_ENTER`, `PREVIEW_LEAVE`, `OWNER_TURN_START_END`, `OWNER_TURN_START`, `OWNER_TURN_END`, `TARGET_TURN_START_END`, `TARGET_TURN_START`, `TARGET_TURN_END`, `ROUND_START_END`, `ROUND_START`, `ROUND_END`, `TARGET_START_MOVE`, `TARGET_END_MOVE` |
| **Effect** | `APPLY_WHILE_INSIDE`, `APPLY_ON_ENTER`, `APPLY_ON_LEAVE`, `APPLY_ON_OWNER_TURN_START`, `APPLY_ON_OWNER_TURN_END`, `APPLY_ON_TARGET_TURN_START`, `APPLY_ON_TARGET_TURN_END`, `APPLY_ON_ROUND_START`, `APPLY_ON_ROUND_END`, `REMOVE_WHILE_INSIDE`, `REMOVE_ON_ENTER`, `REMOVE_ON_LEAVE`, `REMOVE_ON_OWNER_TURN_START`, `REMOVE_ON_OWNER_TURN_END`, `REMOVE_ON_TARGET_TURN_START`, `REMOVE_ON_TARGET_TURN_END`, `REMOVE_ON_ROUND_START`, `REMOVE_ON_ROUND_END` |

</details>

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>deleteAuras</code></h4> <sup>async</sup></summary>

```js
await api.deleteAuras(owner, filter, options)
```

Deletes auras from the specified owner. Safely cleans up any associated lambda callbacks from memory.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">owner</b> | `Token\|Item` | *required* | The document that owns the auras |
| <b style="color:#e0a050">filter</b> | `string\|Object` | *required* | String ID, name, or Object filter |
| <b style="color:#e0a050">options</b> | `Object` | `{}` | Internal Grid-Aware Auras delete options |

</details>
