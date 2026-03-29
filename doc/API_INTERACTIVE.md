<h1>API — Interactive Tools, Deployment & Movement</h1>

[Back to API Reference](API_REFERENCE.md)

<br>

<h2>Interactive Player Tools</h2>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>chooseToken</code></h4> <sup>async</sup> → <code>Array&lt;Token&gt; | null</code></summary>

```js
const targets = await api.chooseToken(casterToken, options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">range</b> | `number` | `null` | Max range highlight |
| <b style="color:#e0a050">count</b> | `number` | `1` | Targets to pick (-1 for unlimited) |
| <b style="color:#e0a050">filter</b> | `Function` | `null` | `(token) => boolean` |
| <b style="color:#e0a050">includeHidden</b> | `boolean` | `false` | Include hidden tokens |
| <b style="color:#e0a050">includeSelf</b> | `boolean` | `false` | Is the caster selectable? |
| <b style="color:#e0a050">title</b> | `string` | `"SELECT TARGETS"` | Card header |
| <b style="color:#e0a050">description</b> | `string` | `""` | Card description |
| <b style="color:#e0a050">icon</b> | `string` | `"fas fa-crosshairs"` | FontAwesome icon |
| <b style="color:#e0a050">headerClass</b> | `string` | `""` | Extra CSS class |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>placeZone</code></h4> <sup>async</sup> → <code>Array&lt;MeasuredTemplate&gt;</code></summary>

```js
await api.placeZone(casterToken, options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">range</b> | `number` | `null` | Max range highlight |
| <b style="color:#e0a050">size</b> | `number` | `1` | Zone size |
| <b style="color:#e0a050">type</b> | `string` | `"Blast"` | `"Blast"`, `"Burst"`, `"Cone"`, `"Line"` |
| <b style="color:#e0a050">fillColor</b> | `string` | `"#ff6400"` | Template color |
| <b style="color:#e0a050">borderColor</b> | `string` | `"#964611ff"` | Template border |
| <b style="color:#e0a050">texture</b> | `string` | `null` | Optional texture path |
| <b style="color:#e0a050">count</b> | `number` | `1` | Number of zones (-1 for unlimited) |
| <b style="color:#e0a050">hooks</b> | `Object` | `{}` | templatemacro hooks (see below) |
| <b style="color:#e0a050">dangerous</b> | `Object` | `null` | `{ damageType, damageValue }` — ENG check on entry/turn start |
| <b style="color:#e0a050">statusEffects</b> | `Array` | `[]` | Status effect IDs applied to tokens inside |
| <b style="color:#e0a050">difficultTerrain</b> | `Object` | `null` | `{ movementPenalty, isFlatPenalty }` — ElevationRuler cost |
| <b style="color:#e0a050">centerLabel</b> | `string` | `""` | Text at center of template on canvas |
| <b style="color:#e0a050">title</b> | `string` | `"PLACE ZONE"` | Card header |

<details><summary><b>Custom Logic via <code>hooks</code></b></summary>

Each hook entry supports two formats that can be combined:

| Format | Description |
|:-------|:------------|
| `{ command: string, asGM: boolean }` | JS code stored in template flags (persists across reloads) |
| `{ function: Function, asGM: boolean }` | JS function in runtime registry (lost on reload) |

Both formats **stack** — if you provide both for the same trigger, both run.

**Trigger List:** `created`, `deleted`, `moved`, `hidden`, `revealed`, `entered`, `left`, `through`, `staying`, `turnStart`, `turnEnd`.

**Available Variables:** `template`, `scene`, `token`, `context` (`this` in command strings).

</details>

**Examples:**
```js
// Dangerous zone
placeZone(token, { size: 2, dangerous: { damageType: "kinetic", damageValue: 5 } });

// Status effect zone
placeZone(token, { size: 2, statusEffects: ["impaired", "lockon"] });

// Difficult terrain
placeZone(token, { size: 2, difficultTerrain: { movementPenalty: 1, isFlatPenalty: true } });

// Custom hook function
api.placeZone(token, {
    size: 2,
    hooks: {
        entered: {
            function: (template, scene, token, context) => {
                const api = game.modules.get('lancer-automations').api;
                api.applyEffectsToTokens({ tokens: [token], effectNames: ["impaired"] });
            },
            asGM: true
        }
    }
});
```

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>placeToken</code></h4> <sup>async</sup></summary>

```js
await api.placeToken(options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">actor</b> | `Actor\|Array` | `null` | Single Actor, Array of Actors, or Array of `{actor, extraData}`. Array shows selector. |
| <b style="color:#e0a050">range</b> | `number` | `null` | Placement range |
| <b style="color:#e0a050">count</b> | `number` | `1` | Total tokens to place |
| <b style="color:#e0a050">extraData</b> | `Object` | `{}` | Default token data overrides. Flags are shallow-merged with prototype flags. |
| <b style="color:#e0a050">origin</b> | `Token\|{x,y}` | `null` | Measurement origin |
| <b style="color:#e0a050">onSpawn</b> | `Function` | `null` | `(newTokenDoc, origin) => {}` |
| <b style="color:#e0a050">title</b> | `string` | `"PLACE TOKEN"` | Card header |
| <b style="color:#e0a050">noCard</b> | `boolean` | `false` | Skip info card |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>knockBackToken</code></h4> <sup>async</sup> → <code>Array&lt;{tokenId, updateData}&gt;</code></summary>

```js
await api.knockBackToken(tokens, distance, options)
```

Interactive knockback tool. Shows visual movement traces and requires confirmation per token.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">tokens</b> | `Array<Token>` | *required* | Tokens to knock back |
| <b style="color:#e0a050">distance</b> | `number` | *required* | Knockback distance in spaces |

**`options` Object:**

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">title</b> | `string` | `"KNOCKBACK"` | Card header |
| <b style="color:#e0a050">description</b> | `string` | `"Select destination for each token."` | Card description |
| <b style="color:#e0a050">triggeringToken</b> | `Token` | `null` | The token causing the knockback (for `onKnockback` trigger) |
| <b style="color:#e0a050">actionName</b> | `string` | `""` | Source action name (enables `onlyOnSourceMatch`) |
| <b style="color:#e0a050">item</b> | `Item` | `null` | Source item |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>revertMovement</code></h4> <sup>async</sup> → <code>boolean</code></summary>

```js
await api.revertMovement(token, destination)
```

Reverts a token to its previous position from movement history. If `destination` is provided, moves to that position instead.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">token</b> | `Token` | *required* | The token to revert |
| <b style="color:#e0a050">destination</b> | `{x, y}` | `null` | Override destination (world coordinates) |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>pickItem</code></h4> <sup>async</sup> → <code>Item | null</code></summary>

```js
const item = await api.pickItem(items, options)
```

Prompts the user to pick an item from a list using a Choice Card.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">items</b> | `Array<Item>` | *required* | Array of items to choose from |
| <b style="color:#e0a050">title</b> | `string` | `"PICK ITEM"` | Card title |
| <b style="color:#e0a050">description</b> | `string` | `"Select an item:"` | Subtitle text |
| <b style="color:#e0a050">icon</b> | `string` | `"fas fa-box"` | FontAwesome class |
| <b style="color:#e0a050">formatText</b> | `Function` | `null` | `(item) => item.name` |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getWeapons</code></h4> · <h4 style="display:inline"><code>reloadOneWeapon</code></h4> · <h4 style="display:inline"><code>rechargeSystem</code></h4> · <h4 style="display:inline"><code>findAura</code></h4> · <h4 style="display:inline"><code>findItemByLid</code></h4></summary>

```js
api.getWeapons(entity)                           // → Array<Item> — all weapons on an actor
await api.reloadOneWeapon(actorOrToken, name?)    // → Item|null — pick & reload a Loading weapon
await api.rechargeSystem(actorOrToken, name?)     // → Item|null — pick & recharge a depleted system
api.findAura(actorOrToken, auraName)              // → object|null — find Grid-Aware Aura by name
api.findItemByLid(actorOrToken, lid)              // → Item|null — find item by Lancer ID
```

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>startChoiceCard</code></h4> <sup>async</sup> → <code>true | null</code></summary>

```js
await api.startChoiceCard(options)
```

Presents a choice card to the user (or GM) with custom buttons and callbacks.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">mode</b> | `string` | `"or"` | `"or"` (pick one), `"and"` (confirm all), `"vote"` (live tally), `"vote-hidden"` (hidden tally) |
| <b style="color:#e0a050">choices</b> | `Array` | `[]` | List of choice objects (see below) |
| <b style="color:#e0a050">title</b> | `string` | `"CHOICE"` | Card header |
| <b style="color:#e0a050">description</b> | `string` | `""` | Subtitle text |
| <b style="color:#e0a050">icon</b> | `string` | `null` | FontAwesome class |
| <b style="color:#e0a050">headerClass</b> | `string` | `""` | Optional CSS class |
| <b style="color:#e0a050">userIdControl</b> | `string\|string[]\|null` | `null` | User IDs for broadcast/vote targets |

**Choice Object:**
```js
{ text: "Label", icon: "fas fa-check", data: { id: 1 }, callback: async (data) => { ... } }
```

> [!TIP]
> For vote modes, `userIdControl` must be a non-empty array of user IDs. The creator sees all votes and manually confirms the winner.

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>openChoiceMenu</code></h4> <sup>async</sup> → <code>void</code></summary>

```js
await api.openChoiceMenu()
```

Opens a GM-facing wizard dialog to configure and broadcast a choice card or vote to active users.

| Mode | Behavior |
|:-----|:---------|
| **Vote** | Each recipient gets a vote card. GM sees live tally, picks winner. |
| **Hidden Vote** | Same, but voters can't see each other's selections. |
| **Pick One (OR)** | First player to click wins. Others dismissed. |
| **Pick All (AND)** | Every recipient must confirm before flow resolves. |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>moveToken</code></h4> <sup>async</sup> → <code>object | null</code></summary>

```js
await api.moveToken(token, options)
```

Moves a token to a destination. Two modes: pass `destination` for a direct move, or omit it for an interactive picker.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">token</b> | `Token` | *required* | The token to move |
| <b style="color:#e0a050">destination</b> | `{x, y}` | `null` | World coordinates. If omitted, interactive picker. |
| <b style="color:#e0a050">range</b> | `number` | `-1` | Max range highlight (interactive mode) |
| <b style="color:#e0a050">cost</b> | `number` | `null` | Movement cost in spaces |
| <b style="color:#e0a050">canBeBlocked</b> | `boolean` | `true` | Whether engagement/overwatch can intercept |
| <b style="color:#e0a050">title</b> | `string` | `"MOVE"` | Card header (interactive mode) |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getTokenOwnerUserId</code></h4> → <code>Array&lt;string&gt;</code></summary>

```js
api.getTokenOwnerUserId(token)
```

Returns the user ID(s) that own a token. Checks active non-GM players first, falls back to the active GM. Useful for routing choice cards to the right player.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">token</b> | `Token` | The token to check |

</details>

<br>

<h2>Deployment & Thrown Weapons</h2>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>addItemFlags</code></h4> <sup>async</sup> → <code>Item</code> · <h4 style="display:inline"><code>getItemFlags</code></h4> → <code>any</code></summary>

```js
await api.addItemFlags(item, flags)            // set flags under 'lancer-automations'
api.getItemFlags(item, flagName?)               // read flags (specific key or all)
```

**Known flag keys:**

| Key | Type | Used by | Description |
|:----|:-----|:--------|:------------|
| <b style="color:#e0a050">deployRange</b> | `number` | `placeDeployable` | Default placement range |
| <b style="color:#e0a050">deployCount</b> | `number` | `placeDeployable` | Default number to place |

**Example:**
```js
await api.addItemFlags(myItem, { deployRange: 5, deployCount: 2 });
```

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>addExtraDeploymentLids</code></h4> <sup>async</sup> → <code>Item</code></summary>

```js
await api.addExtraDeploymentLids(item, lids)
```

Adds extra deployable LIDs to an item via flags. Since Lancer's TypeDataModel prevents writing to `system.deployables` on NPC features, this stores extra LIDs as flags merged in by `getItemDeployables`.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">item</b> | `Item` | The item to update |
| <b style="color:#e0a050">lids</b> | `string\|Array<string>` | LID string(s) to add |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>addExtraActions</code></h4> <sup>async</sup> · <h4 style="display:inline"><code>getItemActions</code></h4> · <h4 style="display:inline"><code>getActorActions</code></h4> · <h4 style="display:inline"><code>removeExtraActions</code></h4> <sup>async</sup></summary>

```js
await api.addExtraActions(target, actions)       // add to Item, Token, or Actor
api.getItemActions(item)                          // → Object[] (system.actions + extras)
api.getActorActions(tokenOrActor)                 // → Object[] (extras on actor)
await api.removeExtraActions(target, filter?)      // string name, predicate, or null (clear all)
```

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">target</b> | `Item\|Token\|Actor` | The document to update |
| <b style="color:#e0a050">actions</b> | `Object\|Array<Object>` | Action object(s) with `{ name, activation, detail }` |
| <b style="color:#e0a050">filter</b> | `Function\|string\|string[]\|null` | Predicate, name, array of names, or null |

**Example:**
```js
await api.addExtraActions(myItem, { name: "Suppressive Fire", activation: "Quick", detail: "..." });
await api.removeExtraActions(myToken, "Custom Strike");
```

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getItemDeployables</code></h4> → <code>string[]</code></summary>

```js
api.getItemDeployables(item, actor)
```

Returns the effective deployable LIDs for an item, merging `system.deployables` with extra LIDs from flags. For NPC actors, applies tier-based selection (1 entry = same for all tiers, 3 entries = pick by tier).

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">item</b> | `Item` | The item document |
| <b style="color:#e0a050">actor</b> | `Actor` | Optional. Owner actor (needed for NPC tier selection) |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>placeDeployable</code></h4> <sup>async</sup></summary>

```js
await api.placeDeployable(options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">deployable</b> | `Actor\|string\|Array` | *required* | LID, Actor, or array (shows selector) |
| <b style="color:#e0a050">ownerActor</b> | `Actor` | *required* | Owner |
| <b style="color:#e0a050">systemItem</b> | `Item` | `null` | Parent item |
| <b style="color:#e0a050">consumeUse</b> | `boolean` | `false` | Consumes system use |
| <b style="color:#e0a050">fromCompendium</b> | `boolean` | `false` | Creates new actor if not in world |
| <b style="color:#e0a050">width</b> | `number` | `null` | Width override |
| <b style="color:#e0a050">height</b> | `number` | `null` | Height override |
| <b style="color:#e0a050">range</b> | `number` | `1` | Placement range (overridden by `deployRange` flag) |
| <b style="color:#e0a050">count</b> | `number` | `1` | Total to place (overridden by `deployCount` flag) |
| <b style="color:#e0a050">at</b> | `Token\|pos` | `null` | Measurement origin |
| <b style="color:#e0a050">title</b> | `string` | `"DEPLOY"` | Card title |
| <b style="color:#e0a050">noCard</b> | `boolean` | `false` | Auto-confirm |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>beginDeploymentCard</code></h4> <sup>async</sup> · <h4 style="display:inline"><code>deployWeaponToken</code></h4> <sup>async</sup></summary>

```js
await api.beginDeploymentCard({ actor, item, deployableOptions: [] })
await api.deployWeaponToken(weapon, ownerActor, originToken, options)
```

| Function | Description |
|:---------|:------------|
| `beginDeploymentCard` | Resolves all deployable LIDs on an item and opens a `placeDeployable` session with actor selector. |
| `deployWeaponToken` | Deploys a weapon as a token on the map (for thrown weapons). Options: `{ range, count, description }` |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>openDeployableMenu</code></h4> · <h4 style="display:inline"><code>recallDeployable</code></h4> · <h4 style="display:inline"><code>pickupWeaponToken</code></h4> · <h4 style="display:inline"><code>openThrowMenu</code></h4> · <h4 style="display:inline"><code>openItemBrowser</code></h4></summary>

```js
await api.openDeployableMenu(actor)      // open deployable management menu
await api.recallDeployable(ownerToken)    // recall a deployed token
await api.pickupWeaponToken(ownerToken)   // pick up a thrown weapon token
await api.openThrowMenu(actor)            // open throw weapon menu
await api.openItemBrowser(targetInput)    // open item browser
```

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>getActivatedItems</code></h4> → <code>Array&lt;Item&gt;</code></summary>

```js
api.getActivatedItems(token)
```

Returns items currently marked as activated on a token (via `setItemAsActivated`). Checks `lancer-automations.activeStateData.active` on each item's flags.

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">token</b> | `Token` | The token to inspect |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>spawnHardCover</code></h4> <sup>async</sup> → <code>void</code></summary>

```js
await api.spawnHardCover(originToken, options)
```

Spawns hard cover deployable tokens on the map.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <b style="color:#e0a050">range</b> | `number` | `null` | Placement range |
| <b style="color:#e0a050">count</b> | `number` | `1` | Number of hard covers |
| <b style="color:#e0a050">size</b> | `number` | `1` | Size override |
| <b style="color:#e0a050">name</b> | `string` | `"Hard Cover"` | Display name |
| <b style="color:#e0a050">title</b> | `string` | `"PLACE HARD COVER"` | Card header |
| <b style="color:#e0a050">description</b> | `string` | `""` | Card description |

</details>

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>addItemTag</code></h4> <sup>async</sup> → <code>Item</code> · <h4 style="display:inline"><code>removeItemTag</code></h4> <sup>async</sup> → <code>Item</code></summary>

```js
await api.addItemTag(item, { id: "tg_heat_self", val: "2" })  // adds or updates tag
await api.removeItemTag(item, "tg_heat_self")                   // removes tag by ID
```

| Param | Type | Description |
|:------|:-----|:------------|
| <b style="color:#e0a050">item</b> | `Item` | The item to modify |
| <b style="color:#e0a050">tagData</b> | `Object` | Tag object (e.g. `{ id: "tg_heat_self", val: "2" }`) |
| <b style="color:#e0a050">tagId</b> | `string` | Tag ID to remove |

</details>

<br>

<h2>Movement Tracking</h2>

These functions accept either a string `tokenId` or a `Token` document/object.

<!-- ═══════════════════════════════════════════════════════════════ -->

<details style="border-left: 3px solid #e0a050; border-bottom: 1px solid #555; padding-left: 12px; padding-bottom: 8px; margin-bottom: 16px;">
<summary><h4 style="display:inline"><code>clearMoveData</code></h4> · <h4 style="display:inline"><code>getCumulativeMoveData</code></h4> · <h4 style="display:inline"><code>getIntentionalMoveData</code></h4> · <h4 style="display:inline"><code>clearMovementHistory</code></h4> · <h4 style="display:inline"><code>getMovementHistory</code></h4> · <h4 style="display:inline"><code>increaseMovementCap</code></h4></summary>

```js
api.clearMoveData(tokenOrId)
api.getCumulativeMoveData(tokenOrId)
api.getIntentionalMoveData(tokenOrId)
await api.clearMovementHistory(tokens, revert)
api.increaseMovementCap(tokenOrId, value)   // add to movement cap for current turn
```

**`getMovementHistory(tokenOrId)`** returns:
```js
{
    exists: boolean,
    totalMoved: number,
    intentional: { total: number, regular: number, free: number },
    unintentional: number,
    nbBoostUsed: number,
    startPosition: { x, y },
    movementCap: number   // max movement this turn (0 if immobilized)
}
```

</details>
