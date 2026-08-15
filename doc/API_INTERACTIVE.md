# API - Interactive Tools & Deployment

[Back to API Reference](API_REFERENCE.md) · Feature guide: [Interactive Tools](feature/INTERACTIVE_TOOLS.md)

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
| <kbd>range</kbd> | `number\|"sensors"` | `null` | Max range for advisory highlight. `"sensors"` = caster's sensor range |
| <kbd>count</kbd> | `number` | `1` | Targets to pick (-1 for unlimited) |
| <kbd>disposition</kbd> | `"friendly"\|"hostile"` | `null` | Keep only tokens with that disposition toward the caster (composes with `filter`) |
| <kbd>filter</kbd> | `(token: Token) => boolean` | `null` | Excludes tokens when returning false |
| <kbd>filterWarning</kbd> | `string` | `null` | Warning text shown under a selected token when it fails `filter` in soft mode |
| <kbd>soft</kbd> | `boolean` | `true` | Range and filter are advisory: invalid tokens can still be clicked. Cursor hover goes orange, the target's card entry gets an amber warning banner listing why. Set `false` to hard-block invalid selections. |
| <kbd>includeHidden</kbd> | `boolean` | `false` | Include hidden tokens |
| <kbd>includeSelf</kbd> | `boolean` | `false` | Caster is selectable |
| <kbd>title</kbd> | `string` | `"SELECT TARGETS"` | Card header |
| <kbd>description</kbd> | `string` | `""` | Card description |
| <kbd>icon</kbd> | `string` | `"fas fa-crosshairs"` | FontAwesome icon |
| <kbd>headerClass</kbd> | `string` | `""` | Extra CSS class |
| <kbd>urgent</kbd> | `boolean` | `false` | Show the card immediately instead of waiting in the card queue |
| <kbd>autoConfirm</kbd> | `boolean` | `false` | Resolve as soon as `count` tokens are selected, no Confirm click |

Generic range failures render as `Out of range (X > Y)`. Filter failures render as `filterWarning` (or `Invalid target` if omitted).

</details>

---

<details>
<summary><b><code>openHaseContestCard</code></b> <sup>async</sup> → <code>{ completed, winner, loser, winnerToken, loserToken, tie, results } | null</code></summary>

<br>

```js
const result = await api.openHaseContestCard(options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>tokenA</kbd> | `Token` | `null` | Contender A |
| <kbd>skillA</kbd> | `string` | `null` | Contender A stat: `HULL` / `AGI` / `SYS` / `ENG` / `GRIT` |
| <kbd>tokenB</kbd> | `Token` | `null` | Contender B |
| <kbd>skillB</kbd> | `string` | `null` | Contender B stat |
| <kbd>title</kbd> | `string` | `"HASE Contest"` | Card and chat title |
| <kbd>sendToOwner</kbd> | `boolean` | `false` | Route each roll to its token owner |

Card to set up and run a HASE contest between two tokens. Returns the [`executeContestedCheck`](API_COMBAT.md) result, or `null` if cancelled. Pre-set fields stay editable, and any missing token/skill is prompted for.

</details>

---

<details>
<summary><b><code>openForceCheckCard</code></b> <sup>async</sup> → <code>{ completed, results } | null</code></summary>

<br>

```js
const result = await api.openForceCheckCard(options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>tokenA</kbd> | `Token` | `null` | Caster for the pickers' range pulse |
| <kbd>skill</kbd> | `string` | `"HULL"` | Stat every target rolls: `HULL` / `AGI` / `SYS` / `ENG` |
| <kbd>range</kbd> | `number` | `null` | Preset range on the target picker |
| <kbd>saveVs</kbd> | `Token\|Actor` | `null` | Save target. Empty = plain check |
| <kbd>targets</kbd> | `Token[]` | `null` | Pre-picked rollers |
| <kbd>sendToOwner</kbd> | `boolean` | `true` | Route each roll to its token owner |

Card to force HASE checks: targets pick like an attack roll, the save target like a stat-roll save. Returns the [`executeForceCheck`](API_COMBAT.md) result, or `null` if cancelled.

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
| <kbd>rangeOrigin</kbd> | `{x, y}\|Token` | `null` | Override the range-measurement origin |
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
| <kbd>expires</kbd> | `Object` | `null` | `{ on: 'ownerTurnStart'\|'ownerTurnEnd', originToken?, turns? }` - template auto-deletes on that combat event (default origin = caster, and `turns` > 1 survives that many occurrences) |

<details>
<summary><b>Custom Logic via <code>hooks</code></b></summary>

Each hook entry supports two formats:

| Format | Description |
|:-------|:------------|
| `{ command: string, asGM: boolean }` | JS code stored in template flags (persists across reloads) |
| `{ function: Function, asGM: boolean }` | JS function in runtime registry (lost on reload) |

Both formats **stack**.

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
<summary><b><code>tokensInTemplate</code></b> → <code>Array&lt;Token&gt;</code></summary>

<br>

```js
const targets = api.tokensInTemplate(templateOrResult)
```

Actor-bearing Tokens currently inside a template. Wraps templatemacro's `findContained` (elevation/terrain-aware, multi-cell + donut templates). Returns `[]` if templatemacro is inactive.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>templateOrResult</kbd> | `MeasuredTemplateDocument \| MeasuredTemplate \| { template }` | A template document, its placeable, or a `placeZone` result |

```js
const [tpl] = await api.placeZone(casterToken, { size: 1, type: "Blast" });
const targets = api.tokensInTemplate(tpl);
if (targets.length) await api.executeDamageRoll(casterToken, targets, 5, "explosive", "Javelin Missile");
```

</details>

---

<details>
<summary><b><code>placeToken</code></b> <sup>async</sup> → <code>Promise&lt;Array&lt;TokenDocument&gt;|null&gt;</code></summary>

<br>

```js
await api.placeToken(options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actor</kbd> | `Actor\|Array<Actor>\|Array<{actor, extraData}>` | `null` | Single Actor, Array of Actors, or Array of `{actor, extraData}`. Array shows selector. |
| <kbd>range</kbd> | `number` | `null` | Placement range |
| <kbd>count</kbd> | `number` | `1` | Total tokens to place |
| <kbd>extraData</kbd> | `Object` | `{}` | Default token data overrides. Flags are shallow-merged with prototype flags. |
| <kbd>origin</kbd> | `Token\|{x: number, y: number}` | `null` | Measurement origin |
| <kbd>onSpawn</kbd> | `(newTokenDoc: TokenDocument, origin: Token) => void \| Promise<void>` | `null` | `(newTokenDoc, origin) => {}` |
| <kbd>title</kbd> | `string` | `"PLACE TOKEN"` | Card header |
| <kbd>noCard</kbd> | `boolean` | `false` | Skip info card |
| <kbd>disposition</kbd> | `number` | `null` | Token disposition override |
| <kbd>team</kbd> | `string` | `null` | token-factions team override |
| <kbd>elevation</kbd> | `number` | `null` | Placement elevation |

</details>

---

<details>
<summary><b><code>knockBackToken</code></b> <sup>async</sup> → <code>Array | null</code></summary>

<br>

```js
await api.knockBackToken(tokens, distance, options)
```

Interactive knockback tool. Shows movement traces and requires confirmation per token.

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
| <kbd>asVoluntary</kbd> | `boolean` | `false` | If true, moves go through the voluntary path (`onPreMove`/`onMove` fire, no `onInvoluntaryMove`). |

</details>

---

<details>
<summary><b><code>revertMovement</code></b> <sup>async</sup> → <code>boolean</code></summary>

<br>

```js
await api.revertMovement(token, destination)
```

Reverts the token's last recorded movement. If the token has no movement history and `destination` is provided, moves there instead.

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

Pick an item from a list via a Choice Card.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>items</kbd> | `Array<Item>` | *required* | Array of items to choose from |
| <kbd>title</kbd> | `string` | `"PICK ITEM"` | Card title |
| <kbd>description</kbd> | `string` | `"Select an item:"` | Subtitle text |
| <kbd>icon</kbd> | `string` | `"fas fa-box"` | FontAwesome class |
| <kbd>formatText</kbd> | `(item: Item) => string` | `null` | `(item) => item.name` |

</details>

---

<details>
<summary><b><code>getWeapons</code></b> → <code>any[]</code> · <b><code>reloadOneWeapon</code></b> <sup>async</sup> → <code>Promise&lt;any | null&gt;</code> · <b><code>rechargeSystem</code></b> <sup>async</sup> → <code>Promise&lt;any | null&gt;</code> · <b><code>findAura</code></b> → <code>object | null</code> · <b><code>getTokensInAura</code></b> → <code>Token[] | null</code> · <b><code>toggleAura</code></b> <sup>async</sup> → <code>Promise&lt;boolean|null&gt;</code> · <b><code>findItemByLid</code></b> → <code>any | null</code></summary>

<br>

```js
api.getWeapons(entity)                                // → Array<Item> - all weapons on an actor
await api.reloadOneWeapon(actorOrToken, name?)         // → Item|null - pick & reload a Loading weapon
await api.rechargeSystem(actorOrToken, name?)          // → Item|null - pick & recharge a depleted system
api.findAura(actorOrToken, auraName)                   // → object|null - find Grid-Aware Aura by name
api.getTokensInAura(actorOrToken, auraName)            // → Token[]|null - who is standing in it
await api.toggleAura(actorOrToken, auraName, on?)      // → boolean|null - flip/set aura's enabled state
api.findItemByLid(actorOrToken, lid)                   // → Item|null - find item by Lancer ID
```

All accept `Actor` | `Token` | `TokenDocument`. `reloadOneWeapon`/`rechargeSystem` open a picker (`name?` is only the notification label). `toggleAura`'s `on?` sets state (omit to flip). Full entry in [API_HOWTO](API_HOWTO.md).

`getTokensInAura` reads GAA's live occupancy, so it is elevation aware and skips drag previews. `null` means it could not be resolved (GAA off, or no such aura), unlike `[]` for an empty aura.

</details>

---

<details>
<summary><b><code>startChoiceCard</code></b> <sup>async</sup> → <code>{ choiceIdx, responderIds } | null</code></summary>

<br>

```js
await api.startChoiceCard(options)
```

Presents a choice card to the user (or GM) with custom buttons and callbacks.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>mode</kbd> | `string` | `"or"` | `"or"` (pick one), `"and"` (confirm all), `"vote"` (live tally), `"vote-hidden"` (hidden tally) |
| <kbd>choices</kbd> | `Array<Object>` | `[]` | List of choice objects (see below) |
| <kbd>title</kbd> | `string` | `"CHOICE"` | Card header |
| <kbd>description</kbd> | `string` | `""` | Subtitle text |
| <kbd>icon</kbd> | `string` | `null` | FontAwesome class |
| <kbd>headerClass</kbd> | `string` | `""` | Optional CSS class |
| <kbd>userIdControl</kbd> | `string\|string[]\|null` | `null` | User IDs for broadcast/vote targets |

**Choice Object:**
```js
{ text: "Label", icon: "fas fa-check", data: { id: 1 }, callback: async (data) => { ... } }
```

For vote modes, `userIdControl` must be a non-empty array of user IDs. The creator sees all votes and confirms the winner.

</details>

---

<details>
<summary><b><code>confirmCard</code></b> <sup>async</sup> → <code>boolean</code> · <b><code>askCard</code></b> <sup>async</sup> → <code>{ confirmed, responderIds }</code> · <b><code>pickCard</code></b> <sup>async</sup> → <code>entry | null</code></summary>

<br>

```js
const ok = await api.confirmCard({ title, description, confirmText, confirmIcon, ... })
const ask = await api.askCard({ title, description, yesText, noText, owner, ... })
const entry = await api.pickCard(entries, { label, entryIcon, title, description, ... })
```

Sugar over `startChoiceCard`. Extra options (`originToken`, `relatedToken`, `item`, `userIdControl`, ...) pass through.

`confirmCard` shows a single button (`confirmText`, default `"Confirm"`). Resolves `true` when clicked, `false` on dismiss.

`askCard` shows two buttons (`yesText`/`noText`, default `"Use"`/`"Skip"`, plus `yesIcon`/`noIcon`). `owner` (a Token) routes control to that token's owner with active-GM fallback. An explicit `userIdControl` wins. The interrupt `preConfirm` shape: `return (await api.askCard({...})).confirmed`.

`pickCard` maps `entries` to buttons and resolves the picked entry (dismiss = `null`). `label`: property name or `(entry) => text` (default `entry.name`). `entryIcon`: fixed icon or `(entry) => icon`.

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
<summary><b><code>moveToken</code></b> <sup>async</sup> → <code>TokenDocument | null</code></summary>

<br>

```js
await api.moveToken(token, options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>token</kbd> | `Token` | *required* | The token to move |
| <kbd>destination</kbd> | `{x: number, y: number}` | `null` | Center point (world coords), snapped to the grid. If omitted, interactive picker. |
| <kbd>teleport</kbd> | `boolean` | `false` | Blink/teleport instead of a slide: plays teleport VFX and records it as a teleport in history. |
| <kbd>action</kbd> | `string` | `null` | Movement action key (see below). Animates the move as that type, forced (ignores walls/cost). Takes precedence over `teleport`. |
| <kbd>range</kbd> | `number` | `-1` | Max range highlight (interactive mode) |
| <kbd>cost</kbd> | `number` | `null` | Movement cost in spaces |
| <kbd>canBeBlocked</kbd> | `boolean` | `true` | Whether engagement/overwatch can intercept |
| <kbd>title</kbd> | `string` | `"TELEPORT"` / `"MOVE"` | Card header (interactive mode). Defaults to TELEPORT when `teleport` is on |

**`action` keys** (the same actions the `M` movement-type wheel offers):

| Key | Wheel label | Availability |
|:----|:------------|:-------------|
| `walk` | Walk | always |
| `fly` | Fly | always |
| `climb` | Climb | always |
| `jump` | Jump | always |
| `blink` | Teleport | always |
| `ignore` | Ignore Elevation | always |
| `crawl` | Crawl | only while prone |
| `forced` | Forced | GM only |

`swim` and `burrow` are disabled by the Lancer system. `displace` is the internal fallback for unknown keys. The API forwards `action` straight to `token.document.move`, so it accepts any key in `CONFIG.Token.movement.actions`. `canSelect` only governs the wheel, not code-driven moves.

</details>

---

<details>
<summary><b><code>getTokenOwnerUserId</code></b> → <code>Array&lt;string&gt;</code></summary>

<br>

```js
api.getTokenOwnerUserId(token)
```

Returns the user ID(s) that own a token. Checks active non-GM players first, falls back to the active GM.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token` | The token to check |

</details>

---

## Deployables & Thrown Weapons

<details>
<summary><b><code>addExtraDeploymentLids</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code> · <b><code>addExtraDeploymentActor</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code> · <b><code>removeExtraDeploymentActor</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code> · <b><code>getActorDeployables</code></b> → <code>string[]</code> · <b><code>getLinkedDeployables</code></b> → <code>string[]</code></summary>

<br>

```js
await api.addExtraDeploymentLids(target, lids)
await api.addExtraDeploymentActor(target, actors)
await api.removeExtraDeploymentActor(target, actors)
api.getActorDeployables(tokenOrActor)
api.getLinkedDeployables(source)   // Item/Actor/Token, combined LIDs+UUIDs
```

Item / Actor / Token target. Item stores on itself. Token/Actor stores on the actor. Both feed `getItemDeployables`, and `getActorDeployables` applies the tier gate with the actor as owner.

**NPC tier:** gate each entry inline - `addExtraDeploymentLids(item, [{ lid, tier: 1 }, { lid, tier: 2 }, ...])` - or separately via `setExtraDeployableOpts(target, key, { tier })` (1-3, unset = all tiers). Legacy: with no explicit tiers, 3 LIDs on an NPC still read positionally as T1/T2/T3.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>target</kbd> | `Item\|Actor\|Token` | Holder |
| <kbd>lids</kbd> | `string\|Array<string\|{lid,tier?,range?,count?}>` | LID(s), or `{ lid, ...opts }` to gate/size each inline |
| <kbd>actors</kbd> | `Actor\|string\|Array<Actor\|string>` | Actor doc(s) or UUID(s) |

</details>

---

<details>
<summary><b><code>getExtraDeployableOpts</code></b> → <code>{ range?: number; count?: number; tier?: 1 | 2 | 3 } | null</code> · <b><code>setExtraDeployableOpts</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code></summary>

<br>

```js
api.getExtraDeployableOpts(target, key)
await api.setExtraDeployableOpts(target, key, opts)
```

Per-deployable range / count / tier override keyed by LID or UUID. `tier` gates the entry to an NPC owner tier. Pass `null` / `''` to clear.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>target</kbd> | `Item\|Actor\|Token` | Holder |
| <kbd>key</kbd> | `string` | LID or actor UUID |
| <kbd>opts</kbd> | `{ range?: number\|null, count?: number\|null, tier?: 1\|2\|3\|null }` | Patch |

</details>

---

<details>
<summary><b><code>setHidePrimaryAction</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code> · <b><code>isPrimaryActionHidden</code></b> → <code>boolean</code></summary>

<br>

```js
await api.setHidePrimaryAction(itemOrUuid, hidden)   // hidden defaults to true
api.isPrimaryActionHidden(item)
```

Hides an item's primary (base) action row in the HUD, leaving only its deployables / extra actions. Also toggleable via the item's Extra Config dialog ("Hide primary action" checkbox). Applies to mech systems and NPC features.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>itemOrUuid</kbd> | `Item\|string` | Item doc or its UUID |
| <kbd>hidden</kbd> | `boolean` | `true` (default) hides, `false` restores |

</details>

---

<details>
<summary><b><code>promptLinkOrUnlinkActor</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code></summary>

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
<summary><b><code>getItemDeployables</code></b> → <code>string[]</code></summary>

<br>

```js
api.getItemDeployables(item, actor)
```

Effective deployable LIDs for an item: `system.deployables` + extra flags, tier-gated for NPC owners (explicit `tier` opts win, honoring `tier_override`, and no explicit tiers = legacy 1-or-3 positional slice). `getAllItemDeployables(item)` = same list unfiltered. `linkTierGate(entry, actor, item?)` / `getOwnerTier(actor, item?)` expose the gate.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>item</kbd> | `Item` | The item document |
| <kbd>actor</kbd> | `Actor` | Optional. Owner actor (needed for NPC tier selection) |

</details>

---

<details>
<summary><b><code>placeDeployable</code></b> <sup>async</sup> → <code>Promise&lt;Object|null&gt;</code></summary>

<br>

```js
await api.placeDeployable(options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>deployable</kbd> | `Actor\|string\|Array<Actor\|string>` | *required* | LID, Actor, or array (shows selector) |
| <kbd>ownerActor</kbd> | `Actor` | *required* | Owner |
| <kbd>systemItem</kbd> | `Item` | `null` | Parent item |
| <kbd>consumeUse</kbd> | `boolean` | `false` | Consumes system use |
| <kbd>fromCompendium</kbd> | `boolean` | `false` | Creates new actor if not in world |
| <kbd>width</kbd> | `number` | `null` | Width override |
| <kbd>height</kbd> | `number` | `null` | Height override |
| <kbd>range</kbd> | `number` | `1` | Placement range (overridden by `deployRange` flag) |
| <kbd>count</kbd> | `number` | `1` | Total to place (overridden by `deployCount` flag) |
| <kbd>at</kbd> | `Token\|Object` | `null` | Measurement origin |
| <kbd>title</kbd> | `string` | `"DEPLOY"` | Card title |
| <kbd>noCard</kbd> | `boolean` | `false` | Auto-confirm |

</details>

---

<details>
<summary><b><code>beginDeploymentCard</code></b> <sup>async</sup> → <code>Promise&lt;boolean&gt;</code> · <b><code>deployWeaponToken</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code></summary>

<br>

```js
await api.beginDeploymentCard({ actor, item, deployableOptions: [] })
await api.deployWeaponToken(weapon, ownerActor, originToken, options)
```

| Function | Description |
|:---------|:------------|
| `beginDeploymentCard` | Resolves all deployable LIDs on an item and opens a `placeDeployable` session with actor selector. |
| `deployWeaponToken` | Deploys a weapon as a token on the map (for thrown weapons). Options: `{ range, title, description, at }` (`at` = measurement origin, `range` default 1). |

</details>

---

<details>
<summary><b><code>openDeployableMenu</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code> · <b><code>recallDeployable</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code> · <b><code>pickupWeaponToken</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code> · <b><code>openThrowMenu</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code> · <b><code>openItemBrowser</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code></summary>

<br>

```js
await api.openDeployableMenu(actor)      // open deployable management menu
await api.recallDeployable(ownerToken)    // recall a deployed token
await api.pickupWeaponToken(ownerToken)   // pick up a thrown weapon token
await api.openThrowMenu(actor)            // open throw weapon menu
await api.openItemBrowser(targetInput)    // open item browser
```

`openThrowMenu(actor?)` defaults to the controlled token's actor. `recallDeployable`/`pickupWeaponToken` take the owner `Token`. `openItemBrowser(targetInput)` fills a jQuery input with the picked item and returns its LID.

</details>

---

## Hard Cover

<details>
<summary><b><code>spawnHardCover</code></b> <sup>async</sup> → <code>Array&lt;TokenDocument&gt; | null</code></summary>

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
