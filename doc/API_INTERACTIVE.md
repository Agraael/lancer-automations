# API - Interactive Tools, Deployment & Movement

[Back to API Reference](API_REFERENCE.md)

---

## Interactive Player Tools

<details>
<summary><b><code>chooseToken</code></b> <sup>async</sup> → <code>Array&lt;Token&gt; | null</code></summary>

<br>

```js
const targets = await api.chooseToken(casterToken, options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>range</kbd> | `number` | `null` | Max range for advisory highlight |
| <kbd>count</kbd> | `number` | `1` | Targets to pick (-1 for unlimited) |
| <kbd>filter</kbd> | `Function` | `null` | `(token) => boolean` - excludes tokens when returning false |
| <kbd>filterWarning</kbd> | `string` | `null` | Warning text shown under a selected token when it fails `filter` in soft mode |
| <kbd>soft</kbd> | `boolean` | `true` | Range and filter are advisory: invalid tokens can still be clicked. Cursor hover goes orange, the target's card entry gets an amber warning banner listing why. Set `false` to hard-block invalid selections (old behavior). |
| <kbd>includeHidden</kbd> | `boolean` | `false` | Include hidden tokens |
| <kbd>includeSelf</kbd> | `boolean` | `false` | Is the caster selectable? |
| <kbd>title</kbd> | `string` | `"SELECT TARGETS"` | Card header |
| <kbd>description</kbd> | `string` | `""` | Card description |
| <kbd>icon</kbd> | `string` | `"fas fa-crosshairs"` | FontAwesome icon |
| <kbd>headerClass</kbd> | `string` | `""` | Extra CSS class |

Generic range failures render as `Out of range (X > Y)`; filter failures render as `filterWarning` (or `Invalid target` if omitted).

</details>

---

<details>
<summary><b><code>placeZone</code></b> <sup>async</sup> → <code>Array&lt;MeasuredTemplate&gt;</code></summary>

<br>

```js
await api.placeZone(casterToken, options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>range</kbd> | `number` | `null` | Max range highlight |
| <kbd>size</kbd> | `number` | `1` | Zone size |
| <kbd>type</kbd> | `string` | `"Blast"` | `"Blast"`, `"Burst"`, `"Cone"`, `"Line"` |
| <kbd>fillColor</kbd> | `string` | `"#ff6400"` | Template color |
| <kbd>borderColor</kbd> | `string` | `"#964611ff"` | Template border |
| <kbd>texture</kbd> | `string` | `null` | Optional texture path |
| <kbd>count</kbd> | `number` | `1` | Number of zones (-1 for unlimited) |
| <kbd>hooks</kbd> | `Object` | `{}` | templatemacro hooks (see below) |
| <kbd>dangerous</kbd> | `Object` | `null` | `{ damageType, damageValue }` - ENG check on entry/turn start |
| <kbd>statusEffects</kbd> | `Array` | `[]` | Status effect IDs applied to tokens inside |
| <kbd>difficultTerrain</kbd> | `Object` | `null` | `{ movementPenalty, isFlatPenalty }` - Lancer Automations Ruler movement cost |
| <kbd>centerLabel</kbd> | `string` | `""` | Text at center of template on canvas |
| <kbd>title</kbd> | `string` | `"PLACE ZONE"` | Card header |

<details>
<summary><b>Custom Logic via <code>hooks</code></b></summary>

Each hook entry supports two formats that can be combined:

| Format | Description |
|:-------|:------------|
| `{ command: string, asGM: boolean }` | JS code stored in template flags (persists across reloads) |
| `{ function: Function, asGM: boolean }` | JS function in runtime registry (lost on reload) |

Both formats **stack** - if you provide both for the same trigger, both run.

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

---

<details>
<summary><b><code>placeToken</code></b> <sup>async</sup></summary>

<br>

```js
await api.placeToken(options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actor</kbd> | `Actor\|Array` | `null` | Single Actor, Array of Actors, or Array of `{actor, extraData}`. Array shows selector. |
| <kbd>range</kbd> | `number` | `null` | Placement range |
| <kbd>count</kbd> | `number` | `1` | Total tokens to place |
| <kbd>extraData</kbd> | `Object` | `{}` | Default token data overrides. Flags are shallow-merged with prototype flags. |
| <kbd>origin</kbd> | `Token\|{x,y}` | `null` | Measurement origin |
| <kbd>onSpawn</kbd> | `Function` | `null` | `(newTokenDoc, origin) => {}` |
| <kbd>title</kbd> | `string` | `"PLACE TOKEN"` | Card header |
| <kbd>noCard</kbd> | `boolean` | `false` | Skip info card |

</details>

---

<details>
<summary><b><code>knockBackToken</code></b> <sup>async</sup> → <code>Array&lt;{tokenId, updateData}&gt;</code></summary>

<br>

```js
await api.knockBackToken(tokens, distance, options)
```

Interactive knockback tool. Shows visual movement traces and requires confirmation per token.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>tokens</kbd> | `Array<Token>` | *required* | Tokens to knock back |
| <kbd>distance</kbd> | `number` | *required* | Knockback distance in spaces |

**`options` Object:**

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>title</kbd> | `string` | `"KNOCKBACK"` | Card header |
| <kbd>description</kbd> | `string` | `"Select destination for each token."` | Card description |
| <kbd>triggeringToken</kbd> | `Token` | `null` | The token causing the move (for `onInvoluntaryMove` trigger) |
| <kbd>actionName</kbd> | `string` | `""` | Source action name (enables `onlyOnSourceMatch`) |
| <kbd>item</kbd> | `Item` | `null` | Source item |
| <kbd>asVoluntary</kbd> | `boolean` | `false` | If true, moves go through the voluntary path (`onPreMove`/`onMove` fire; no `onInvoluntaryMove`). If false (default), moves are involuntary and fire `onInvoluntaryMove` before each move. |

</details>

---

<details>
<summary><b><code>revertMovement</code></b> <sup>async</sup> → <code>boolean</code></summary>

<br>

```js
await api.revertMovement(token, destination)
```

Reverts a token to its previous position from movement history. If `destination` is provided, moves to that position instead.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>token</kbd> | `Token` | *required* | The token to revert |
| <kbd>destination</kbd> | `{x, y}` | `null` | Override destination (world coordinates) |

</details>

---

<details>
<summary><b><code>pickItem</code></b> <sup>async</sup> → <code>Item | null</code></summary>

<br>

```js
const item = await api.pickItem(items, options)
```

Prompts the user to pick an item from a list using a Choice Card.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>items</kbd> | `Array<Item>` | *required* | Array of items to choose from |
| <kbd>title</kbd> | `string` | `"PICK ITEM"` | Card title |
| <kbd>description</kbd> | `string` | `"Select an item:"` | Subtitle text |
| <kbd>icon</kbd> | `string` | `"fas fa-box"` | FontAwesome class |
| <kbd>formatText</kbd> | `Function` | `null` | `(item) => item.name` |

</details>

---

<details>
<summary><b><code>getWeapons</code></b> · <b><code>reloadOneWeapon</code></b> · <b><code>rechargeSystem</code></b> · <b><code>findAura</code></b> · <b><code>toggleAura</code></b> · <b><code>findItemByLid</code></b></summary>

<br>

```js
api.getWeapons(entity)                                // → Array<Item> - all weapons on an actor
await api.reloadOneWeapon(actorOrToken, name?)         // → Item|null - pick & reload a Loading weapon
await api.rechargeSystem(actorOrToken, name?)          // → Item|null - pick & recharge a depleted system
api.findAura(actorOrToken, auraName)                   // → object|null - find Grid-Aware Aura by name
await api.toggleAura(actorOrToken, auraName, on?)      // → boolean|null - flip/set aura's enabled state
api.findItemByLid(actorOrToken, lid)                   // → Item|null - find item by Lancer ID
```

</details>

---

<details>
<summary><b><code>startChoiceCard</code></b> <sup>async</sup> → <code>true | null</code></summary>

<br>

```js
await api.startChoiceCard(options)
```

Presents a choice card to the user (or GM) with custom buttons and callbacks.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>mode</kbd> | `string` | `"or"` | `"or"` (pick one), `"and"` (confirm all), `"vote"` (live tally), `"vote-hidden"` (hidden tally) |
| <kbd>choices</kbd> | `Array` | `[]` | List of choice objects (see below) |
| <kbd>title</kbd> | `string` | `"CHOICE"` | Card header |
| <kbd>description</kbd> | `string` | `""` | Subtitle text |
| <kbd>icon</kbd> | `string` | `null` | FontAwesome class |
| <kbd>headerClass</kbd> | `string` | `""` | Optional CSS class |
| <kbd>userIdControl</kbd> | `string\|string[]\|null` | `null` | User IDs for broadcast/vote targets |

**Choice Object:**
```js
{ text: "Label", icon: "fas fa-check", data: { id: 1 }, callback: async (data) => { ... } }
```

> **Note:** For vote modes, `userIdControl` must be a non-empty array of user IDs. The creator sees all votes and manually confirms the winner.

</details>

---

<details>
<summary><b><code>openChoiceMenu</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

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

---

<details>
<summary><b><code>moveToken</code></b> <sup>async</sup> → <code>object | null</code></summary>

<br>

```js
await api.moveToken(token, options)
```

Moves a token to a destination. Two modes: pass `destination` for a direct move, or omit it for an interactive picker.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>token</kbd> | `Token` | *required* | The token to move |
| <kbd>destination</kbd> | `{x, y}` | `null` | World coordinates. If omitted, interactive picker. |
| <kbd>range</kbd> | `number` | `-1` | Max range highlight (interactive mode) |
| <kbd>cost</kbd> | `number` | `null` | Movement cost in spaces |
| <kbd>canBeBlocked</kbd> | `boolean` | `true` | Whether engagement/overwatch can intercept |
| <kbd>title</kbd> | `string` | `"MOVE"` | Card header (interactive mode) |

</details>

---

<details>
<summary><b><code>getTokenOwnerUserId</code></b> → <code>Array&lt;string&gt;</code></summary>

<br>

```js
api.getTokenOwnerUserId(token)
```

Returns the user ID(s) that own a token. Checks active non-GM players first, falls back to the active GM. Useful for routing choice cards to the right player.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token` | The token to check |

</details>

---

## Deployment & Thrown Weapons

<details>
<summary><b><code>addItemFlags</code></b> <sup>async</sup> → <code>Item</code> · <b><code>removeItemFlags</code></b> <sup>async</sup> → <code>Item</code> · <b><code>getItemFlags</code></b> → <code>any</code></summary>

<br>

```js
await api.addItemFlags(item, flags)            // set flags under 'lancer-automations'
await api.removeItemFlags(item, flags)         // unset the listed keys
api.getItemFlags(item, flagName?)              // read flags (specific key or all)
```

Routes through the GM via socket when the calling user does not own the item, so it is safe to call from any client.

**Known flag keys:**

| Key | Type | Used by | Description |
|:----|:-----|:--------|:------------|
| <kbd>deployRange</kbd> | `number` | `placeDeployable` | Default placement range |
| <kbd>deployCount</kbd> | `number` | `placeDeployable` | Default number to place |

**Example:**
```js
await api.addItemFlags(myItem, { deployRange: 5, deployCount: 2 });
```

</details>

---

<details>
<summary><b><code>addActorFlags</code></b> <sup>async</sup> → <code>Actor</code> · <b><code>removeActorFlags</code></b> <sup>async</sup> → <code>Actor</code> · <b><code>getActorFlags</code></b> → <code>any</code></summary>

<br>

```js
await api.addActorFlags(actor, flags)          // set flags under 'lancer-automations'
await api.removeActorFlags(actor, flags)       // unset the listed keys
api.getActorFlags(actor, flagName?)            // read flags (specific key or all)
```

Routes through the GM via socket when the calling user does not own the actor.

**Known flag keys (deployable Mines, read by the `Mine Zone` general reaction):**

| Key | Type | Default | Description |
|:----|:-----|:--------|:------------|
| <kbd>mineDetectionRadius</kbd> | `number` | `1` | Aura radius in grid units. |
| <kbd>mineDetectionDisposition</kbd> | `"ALL"` \| `"FRIENDLY"` \| `"HOSTILE"` \| `"NEUTRAL"` | `"ALL"` | Which disposition triggers the detonation prompt. |
| <kbd>customMineDetection</kbd> | `boolean` | `false` | Skip the default `LA_MineZone` aura entirely; the per-LID handler installs its own detection. |

**Example:**
```js
// Custom mine: 3-space radius, hostile only.
await api.addActorFlags(mineActor, {
    mineDetectionRadius: 3,
    mineDetectionDisposition: "HOSTILE"
});
```

</details>

---

<details>
<summary><b><code>addExtraDeploymentLids</code></b> <sup>async</sup> · <b><code>addExtraDeploymentActor</code></b> <sup>async</sup> · <b><code>removeExtraDeploymentActor</code></b> <sup>async</sup> · <b><code>getActorDeployables</code></b></summary>

<br>

```js
await api.addExtraDeploymentLids(target, lids)
await api.addExtraDeploymentActor(target, actors)
await api.removeExtraDeploymentActor(target, actors)
api.getActorDeployables(tokenOrActor)
```

Item / Actor / Token target. Item stores on itself; Token/Actor stores on the actor. Both feed `getItemDeployables`.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>target</kbd> | `Item\|Actor\|Token` | Holder |
| <kbd>lids</kbd> | `string\|Array<string>` | LID(s) |
| <kbd>actors</kbd> | `Actor\|string\|Array<Actor\|string>` | Actor doc(s) or UUID(s) |

</details>

---

<details>
<summary><b><code>getExtraDeployableOpts</code></b> · <b><code>setExtraDeployableOpts</code></b> <sup>async</sup></summary>

<br>

```js
api.getExtraDeployableOpts(target, key)
await api.setExtraDeployableOpts(target, key, opts)
```

Per-extra range / count override keyed by LID or UUID. Overrides item-level `deployRange` / `deployCount`. Pass `null` / `''` to clear.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>target</kbd> | `Item\|Actor\|Token` | Holder |
| <kbd>key</kbd> | `string` | LID or actor UUID |
| <kbd>opts</kbd> | `{ range?: number\|null, count?: number\|null }` | Patch |

</details>

---

<details>
<summary><b><code>promptLinkOrUnlinkActor</code></b> <sup>async</sup></summary>

<br>

```js
await api.promptLinkOrUnlinkActor(ownerToken)
```

Picker that toggles the deployable-owner link flag (`ownerActorUuid` + `ownerName`) on the picked token. Already-linked tokens show as invalid with a click-to-unlink warning.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>ownerToken</kbd> | `Token` | Owner |

</details>

---

<details>
<summary><b><code>consumeExtraAction</code></b> <sup>async</sup> · <b><code>reloadExtraAction</code></b> <sup>async</sup> · <b><code>rechargeExtraActionsForActor</code></b> <sup>async</sup></summary>

<br>

```js
await api.consumeExtraAction(target, actionName)
await api.reloadExtraAction(target, actionName)
await api.rechargeExtraActionsForActor(actor)
```

Charge plumbing for extras with `tg_loading` / `tg_recharge` / `tg_limited` tags. `consume` decrements / spends, returns `false` if depleted. `reload` resets. `recharge` rolls 1d6 vs `entry.recharge` per uncharged entry (fires on turn start).

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>target</kbd> | `Item\|Actor` | Holder of `extraActions` flag |
| <kbd>actionName</kbd> | `string` | Matches `action.name` |
| <kbd>actor</kbd> | `Actor` | Recharge sweep target |

</details>

---

<details>
<summary><b><code>openExtrasDialog</code></b></summary>

<br>

```js
api.openExtrasDialog(actor)
```

Dialog for managing actor-level extras (extra actions + extra deployment actors). Only lists entries created here. Also reachable via TAH > Utility > Misc > Add Extra.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>actor</kbd> | `Actor` | Owner |

</details>

---

<details>
<summary><b><code>addExtraActions</code></b> <sup>async</sup> · <b><code>getItemActions</code></b> · <b><code>getActorActions</code></b> · <b><code>removeExtraActions</code></b> <sup>async</sup></summary>

<br>

```js
await api.addExtraActions(target, actions)       // add to Item, Token, or Actor
api.getItemActions(item)                          // → Object[] (system.actions + extras)
api.getActorActions(tokenOrActor)                 // → Object[] (extras on actor)
await api.removeExtraActions(target, filter?)     // string name, predicate, or null (clear all)
```

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>target</kbd> | `Item\|Token\|Actor` | Item stores on itself; Token/Actor stores on the actor |
| <kbd>actions</kbd> | `ExtraAction\|ExtraAction[]` | One action or an array |
| <kbd>filter</kbd> | `Function\|string\|string[]\|null` | Predicate, name, array of names, or null (clear all) |

**`ExtraAction` shape** (`LancerAction` + extras):

| Field | Type | Notes |
|:------|:-----|:------|
| `name` | `string` | Required |
| `activation` | `string` | Required. `"Quick"` / `"Full"` / `"Protocol"` / `"Reaction"` / `"Free"` / `"Quick Tech"` / `"Full Tech"` / `"Invade"` |
| `detail` | `string` | HTML effect text |
| `lid`, `cost`, `heat_cost`, `frequency`, `init`, `trigger`, `terse` | various | Standard `LancerAction` fields |
| `tech_attack` | `boolean` | Routes click through `beginTechAttackFlow` |
| `damage`, `range` | `Array<{val,type}>` | Same shape as system actions |
| `mech`, `pilot` | `boolean` | Visibility gates |
| `tags` | `Array<{lid,val}>` | Standard Lancer tags |
| `icon` | `string` | TAH icon override (path or FontAwesome class) |
| `recharge`, `charged` | `number`, `boolean` | Charge state for `tg_recharge` actions |
| `uses` | `{value,max}` | Charge state for `tg_limited` actions |

**Auto-behaviors when target is an Item:**
- `_sourceItemId` is stamped onto every added action so `onlyOnSourceMatch` reactions can resolve the parent item.
- If the action carries a consumable tag (`tg_loading` / `tg_recharge` / `tg_limited`) that's already on the parent item, that tag is stripped from the action along with its state field (`loaded` / `charged`+`recharge` / `uses`). A warning is shown. Keeps the item-level state as the single source of truth.

**Example:**
```js
await api.addExtraActions(myItem, { name: "Suppressive Fire", activation: "Quick", detail: "..." });
await api.removeExtraActions(myToken, "Custom Strike");
```

</details>

---

<details>
<summary><b><code>lockActorAction</code></b> <sup>async</sup> · <b><code>unlockActorAction</code></b> <sup>async</sup> · <b><code>isActionLocked</code></b> · <b><code>getLockedActions</code></b></summary>

<br>

```js
await api.lockActorAction(actor, actionName, sourceId)
await api.unlockActorAction(actor, actionName, sourceId)
api.isActionLocked(actor, actionName)        // → boolean
api.getLockedActions(actor)                  // → string[]
```

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>actor</kbd> | `Actor\|Token\|TokenDocument` | Target actor |
| <kbd>actionName</kbd> | `string` | Standard action display name (`"Boost"`, `"Grapple"`, ...) |
| <kbd>sourceId</kbd> | `string` | Stable key (typically `item.id`). Source-tracked; stays locked until every source is removed. |

Locked actions are greyed in TAH and clicks are blocked.

```js
onInit: async function (token, item, api) {
    await api.lockActorAction(token.actor, "Boost", item.id);
    await api.addExtraActions(token.actor, { name: "Boost (Industrial)", activation: "Full", detail: "..." });
}
```

</details>

---

<details>
<summary><b><code>getItemDeployables</code></b> → <code>string[]</code></summary>

<br>

```js
api.getItemDeployables(item, actor)
```

Returns the effective deployable LIDs for an item, merging `system.deployables` with extra LIDs from flags. For NPC actors, applies tier-based selection (1 entry = same for all tiers, 3 entries = pick by tier).

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>item</kbd> | `Item` | The item document |
| <kbd>actor</kbd> | `Actor` | Optional. Owner actor (needed for NPC tier selection) |

</details>

---

<details>
<summary><b><code>placeDeployable</code></b> <sup>async</sup></summary>

<br>

```js
await api.placeDeployable(options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>deployable</kbd> | `Actor\|string\|Array` | *required* | LID, Actor, or array (shows selector) |
| <kbd>ownerActor</kbd> | `Actor` | *required* | Owner |
| <kbd>systemItem</kbd> | `Item` | `null` | Parent item |
| <kbd>consumeUse</kbd> | `boolean` | `false` | Consumes system use |
| <kbd>fromCompendium</kbd> | `boolean` | `false` | Creates new actor if not in world |
| <kbd>width</kbd> | `number` | `null` | Width override |
| <kbd>height</kbd> | `number` | `null` | Height override |
| <kbd>range</kbd> | `number` | `1` | Placement range (overridden by `deployRange` flag) |
| <kbd>count</kbd> | `number` | `1` | Total to place (overridden by `deployCount` flag) |
| <kbd>at</kbd> | `Token\|pos` | `null` | Measurement origin |
| <kbd>title</kbd> | `string` | `"DEPLOY"` | Card title |
| <kbd>noCard</kbd> | `boolean` | `false` | Auto-confirm |

</details>

---

<details>
<summary><b><code>beginDeploymentCard</code></b> <sup>async</sup> · <b><code>deployWeaponToken</code></b> <sup>async</sup></summary>

<br>

```js
await api.beginDeploymentCard({ actor, item, deployableOptions: [] })
await api.deployWeaponToken(weapon, ownerActor, originToken, options)
```

| Function | Description |
|:---------|:------------|
| `beginDeploymentCard` | Resolves all deployable LIDs on an item and opens a `placeDeployable` session with actor selector. |
| `deployWeaponToken` | Deploys a weapon as a token on the map (for thrown weapons). Options: `{ range, count, description }` |

</details>

---

<details>
<summary><b><code>openDeployableMenu</code></b> · <b><code>recallDeployable</code></b> · <b><code>pickupWeaponToken</code></b> · <b><code>openThrowMenu</code></b> · <b><code>openItemBrowser</code></b></summary>

<br>

```js
await api.openDeployableMenu(actor)      // open deployable management menu
await api.recallDeployable(ownerToken)    // recall a deployed token
await api.pickupWeaponToken(ownerToken)   // pick up a thrown weapon token
await api.openThrowMenu(actor)            // open throw weapon menu
await api.openItemBrowser(targetInput)    // open item browser
```

</details>

---

<details>
<summary><b><code>getActivatedItems</code></b> → <code>Array&lt;Item&gt;</code></summary>

<br>

```js
api.getActivatedItems(token)
```

Returns items currently marked as activated on a token (via `setItemAsActivated`). Checks `lancer-automations.activeStateData.active` on each item's flags.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token` | The token to inspect |

</details>

---

<details>
<summary><b><code>spawnHardCover</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.spawnHardCover(originToken, options)
```

Spawns hard cover deployable tokens on the map.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>range</kbd> | `number` | `null` | Placement range |
| <kbd>count</kbd> | `number` | `1` | Number of hard covers |
| <kbd>size</kbd> | `number` | `1` | Size override |
| <kbd>name</kbd> | `string` | `"Hard Cover"` | Display name |
| <kbd>title</kbd> | `string` | `"PLACE HARD COVER"` | Card header |
| <kbd>description</kbd> | `string` | `""` | Card description |

</details>

---

<details>
<summary><b><code>addItemTag</code></b> <sup>async</sup> → <code>Item</code> · <b><code>removeItemTag</code></b> <sup>async</sup> → <code>Item</code></summary>

<br>

```js
await api.addItemTag(item, { id: "tg_heat_self", val: "2" })  // adds or updates tag
await api.removeItemTag(item, "tg_heat_self")                   // removes tag by ID
```

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>item</kbd> | `Item` | The item to modify |
| <kbd>tagData</kbd> | `Object` | Tag object (e.g. `{ id: "tg_heat_self", val: "2" }`) |
| <kbd>tagId</kbd> | `string` | Tag ID to remove |

</details>

---

## Movement Tracking

These functions accept either a string `tokenId` or a `Token` document/object.

<details>
<summary><b><code>clearMoveData</code></b> · <b><code>getCumulativeMoveData</code></b> · <b><code>getIntentionalMoveData</code></b> · <b><code>clearMovementHistory</code></b> · <b><code>getMovementHistory</code></b> · <b><code>increaseMovementCap</code></b></summary>

<br>

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

---

## Extra Stat Bars

Extra bars drawn under a token's HP/Heat/etc. Stored per-token at `flags.lancer-automations.statBarExtras`. Non-auto entries also show up in the TAH Resources column.

<details>
<summary><b><code>addExtraBar</code></b> <sup>async</sup> → <code>string | null</code></summary>

<br>

```js
const id = await api.addExtraBar(token, partial)
```

Create a new extra bar by overlaying `partial` on the default shape. Returns the new entry id, or `null` on failure. API-created entries default to `ownerOnly: true` (only the actor's owners and the GM see them); pass `ownerOnly: false` in `partial` to make it public.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>token</kbd> | `Token | TokenDocument | string` | *required* | A Token, TokenDocument, id, or uuid |
| <kbd>partial</kbd> | `object` | `{}` | Fields overlaying the default entry (see shape below) |

Entry shape (all fields optional in `partial`):

```js
{
    id: string,                    // auto-generated if missing
    label: string,                 // short tag, e.g. "AP"
    layoutMode: 'newLine' | 'sameLine',
    widthPct: number,              // 1..100
    valueSource: { kind: 'path' | 'manual', path?: string, value?: number },
    maxSource:   { kind: 'path' | 'manual', path?: string, value?: number },
    segmented: boolean,            // when on, pip count = resolved max
    color: { kind: 'solid', stops: ['#RRGGBB'] },
    ownerOnly: boolean,
    icon: string,                  // file path
    showLabelInHint: boolean,      // show label in the hover stat hint
    linkedItemUuid: string,        // right-click in TAH opens this item's sheet
}
```

`valueSource.path` / `maxSource.path` understand three prefixes:
- `system.X` — reads from the actor
- `items.{itemId}.X` — reads from `actor.items.get(itemId)`
- `pilotItems.{itemId}.X` — reads from the pilot's items when the actor is a mech

</details>

---

<details>
<summary><b><code>updateExtraBarValue</code></b> <sup>async</sup> → <code>number | null</code></summary>

<br>

```js
const newVal = await api.updateExtraBarValue(token, entryId, value)
```

Update the value of an extra bar. Manual entries write the per-token flag; path-bound entries write back through `item.update()` or `actor.update()` at the source path. Returns the new value, or `null` if the token/entry is invalid.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>token</kbd> | `Token | TokenDocument | string` | *required* | A Token, TokenDocument, id, or uuid |
| <kbd>entryId</kbd> | `string` | *required* | The entry's id |
| <kbd>value</kbd> | `number | string` | *required* | A number, numeric string, or delta string (`"+2"` / `"-3"`) |

</details>

---

<details>
<summary><b><code>removeExtraBar</code></b> <sup>async</sup> → <code>boolean</code></summary>

<br>

```js
const ok = await api.removeExtraBar(token, entryId)
```

Remove an extra bar by id. Returns `true` if removed, `false` if not found.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>token</kbd> | `Token | TokenDocument | string` | *required* | A Token, TokenDocument, id, or uuid |
| <kbd>entryId</kbd> | `string` | *required* | The entry's id |

</details>
