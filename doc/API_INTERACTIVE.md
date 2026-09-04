# API - Interactive Tools & Deployment

[Back to API Reference](API_REFERENCE.md) · Feature guide: [Interactive Tools](feature/INTERACTIVE_TOOLS.md)

---

## Selection

<details id="chooseToken">
<summary><b><code>chooseToken</code></b> <sup>async</sup> → <code>Array&lt;Token&gt; | null</code></summary>

<br>

```js
const targets = await api.chooseToken(casterToken, options)
```

```js
const picked = await api.chooseToken(casterToken, {
    title: 'PICK ALLY',
    range: 5,
    includeSelf: false,
    count: 1
});
const target = picked?.[0];
if (!target) return;
```

```js
const caught = await api.chooseToken(casterToken, {
    title: 'BLAST 1',
    range: 10,
    pattern: 'blast',
    areaRange: 1,
    allowEmptyConfirm: true
});
```

```js
const selected = await api.chooseToken(ownerToken, {
    title: 'RECALL DEPLOYABLE',
    selection: deployedTokens,
    includeSelf: false,
    count: 1
});
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
| <kbd>range</kbd> | `number\|"sensors"` | `null` | Max range for advisory highlight. `"sensors"` = caster's sensor range |
| <kbd>count</kbd> | `number` | `1` | Targets to pick (-1 for unlimited) |
| <kbd>disposition</kbd> | `"friendly"\|"hostile"` | `null` | Keep only tokens with that disposition toward the caster (composes with `filter`) |
| <kbd>filter</kbd> | `(token: Token) => boolean` | `null` | Excludes tokens when returning false |
| <kbd>filterWarning</kbd> | `string` | `null` | Warning text shown under a selected token when it fails `filter` in soft mode |
| <kbd>soft</kbd> | `boolean` | `true` | Range and filter are advisory: invalid tokens can still be clicked. Cursor hover goes orange, the target's card entry gets an amber warning banner listing why. Set `false` to hard-block invalid selections. |
| <kbd>includeSelf</kbd> | `boolean` | `true` | Caster is selectable |
| <kbd>selection</kbd> | `Token[]` | `null` | Restrict picking to these tokens |
| <kbd>preSelected</kbd> | `Token[]` | `[]` | Start with these selected. Ignored in blast mode; trimmed to `count` with a warning if longer |
| <kbd>allowEmptyConfirm</kbd> | `boolean` | `false` | Confirming with nothing selected resolves `[]` instead of `null` |
| <kbd>pattern</kbd> | `"token"\|"blast"\|"burst"\|"cone"\|"line"` | `"token"` | Pick tokens directly, or place an area that captures them |
| <kbd>areaRange</kbd> | `number` | `null` | Area size in spaces. Required when `pattern` is not `"token"`, must be >= 1 or the call resolves `null` |
| <kbd>areaCount</kbd> | `number` | `1` | Areas to place. `0` counts as `1` |
| <kbd>size</kbd> | `number` | `1` | Line width in cells, perpendicular to the line. `"line"` only |
| <kbd>elevationAware</kbd> | `boolean` | setting | Area respects elevation. Falls back to the `tah.areaElevationAware` setting |
| <kbd>autoElevation</kbd> | `boolean` | `true` | Area sits on the ground elevation under its center |
| <kbd>propagation</kbd> | `boolean` | `false` | Area spreads cell to cell from its origin and tall terrain blocks it. Needs `elevationAware` |
| <kbd>los</kbd> | `boolean` | `true` | Range pulse clipped by line of sight. Needs the `rangePulseLos` setting |
| <kbd>title</kbd> | `string` | `"SELECT TARGETS"` | Card header |
| <kbd>description</kbd> | `string` | `""` | Card description |
| <kbd>icon</kbd> | `string` | `"fas fa-crosshairs"` | FontAwesome icon |
| <kbd>headerClass</kbd> | `string` | `""` | Extra CSS class |
| <kbd>urgent</kbd> | `boolean` | `false` | Show the card immediately instead of waiting in the card queue |
| <kbd>autoConfirm</kbd> | `boolean` | `false` | Resolve as soon as `count` tokens are selected, no Confirm click |

`casterToken` is the measuring origin for `range` and disposition checks.

Generic range failures render as `Out of range (X > Y)`. Filter failures render as `filterWarning` (or `Invalid target` if omitted).

Hidden tokens are included for GMs and excluded for players. Not an option.

</details>

<details id="pickItem">
<summary><b><code>pickItem</code></b> <sup>async</sup> → <code>Item | null</code></summary>

<br>

```js
const item = await api.pickItem(items, options)
```

Pick an item from a list via a Choice Card.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>items</kbd> | `Array<Item>` | *required* | Array of items to choose from |
| **inside `options`** | | | |
| <kbd>title</kbd> | `string` | `"PICK ITEM"` | Card title |
| <kbd>description</kbd> | `string` | `"Select an item:"` | Subtitle text |
| <kbd>icon</kbd> | `string` | `"fas fa-box"` | FontAwesome class |
| <kbd>formatText</kbd> | `(item: Item) => string` | `null` | `(item) => item.name` |

```js
const weapon = await api.pickItem(actor.items.filter(i => i.type === 'mech_weapon'), { title: 'PICK WEAPON' });
```

</details>

<details id="getWeapons">
<summary><b><code>getWeapons</code></b> → <code>any[]</code><br><b><code>reloadOneWeapon</code></b> <sup>async</sup> → <code>Promise&lt;any | null&gt;</code><br><b><code>rechargeSystem</code></b> <sup>async</sup> → <code>Promise&lt;any | null&gt;</code><br><b><code>findAura</code></b> → <code>object | null</code><br><b><code>getTokensInAura</code></b> → <code>Token[] | null</code><br><b><code>toggleAura</code></b> <sup>async</sup> → <code>Promise&lt;boolean|null&gt;</code><br><b><code>findItemByLid</code></b> → <code>any | null</code></summary>

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

**Params:** <kbd>actorOrToken</kbd> / <kbd>entity</kbd> `Actor|Token|TokenDocument` · <kbd>auraName</kbd> `string` · <kbd>lid</kbd> `string` · <kbd>targetName</kbd> `string` picker notification label

All accept `Actor` | `Token` | `TokenDocument`. `reloadOneWeapon`/`rechargeSystem` open a picker (`name?` is only the notification label). `toggleAura`'s `on?` sets state (omit to flip). Full entry in [API_HOWTO](API_HOWTO.md).

`getTokensInAura` reads GAA's live occupancy, so it is elevation aware and skips drag previews. `null` means it could not be resolved (GAA off, or no such aura), unlike `[]` for an empty aura.

</details>

<details id="getTokenOwnerUserId">
<summary><b><code>getTokenOwnerUserId</code></b> → <code>Array&lt;string&gt;</code></summary>

<br>

```js
api.getTokenOwnerUserId(token)
```

Returns the user ID(s) that own a token. Checks active non-GM players first, falls back to the active GM.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>token</kbd> | `Token` | The token to check |

```js
const userId = api.getTokenOwnerUserId(target) ?? game.users.activeGM?.id;
```

</details>

## Cards & Prompts

<details id="openHaseContestCard">
<summary><b><code>openHaseContestCard</code></b> <sup>async</sup> → <code>{ completed, winner, loser, winnerToken, loserToken, tie, results } | null</code></summary>

<br>

```js
const result = await api.openHaseContestCard(options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `opts`** | | | |
| <kbd>tokenA</kbd> | `Token` | `null` | Contender A |
| <kbd>skillA</kbd> | `string` | `null` | Contender A stat: `HULL` / `AGI` / `SYS` / `ENG` / `GRIT` |
| <kbd>tokenB</kbd> | `Token` | `null` | Contender B |
| <kbd>skillB</kbd> | `string` | `null` | Contender B stat |
| <kbd>title</kbd> | `string` | `"HASE Contest"` | Card and chat title |
| <kbd>sendToOwner</kbd> | `boolean` | `false` | Route each roll to its token owner |
| <kbd>accuracy1</kbd> / <kbd>difficulty1</kbd> / <kbd>flatModifier1</kbd> | `number` | `0` | Pre-fill contender A's HASE HUD. `2` variants do the same for B |
| <kbd>sourceItem</kbd> / <kbd>sourceAction</kbd> / <kbd>extraData</kbd> | | `null` | Attribution, forwarded to [`executeContestedCheck`](API_COMBAT.md#executeContestedCheck) |

Card to set up and run a HASE contest between two tokens. Returns the [`executeContestedCheck`](API_COMBAT.md) result, or `null` if cancelled. Pre-set fields stay editable, and any missing token/skill is prompted for.

```js
const result = await api.openHaseContestCard({ tokenA, skillA: 'HULL', tokenB, skillB: 'AGI', title: 'Grapple' });
```

</details>

<details id="openForceCheckCard">
<summary><b><code>openForceCheckCard</code></b> <sup>async</sup> → <code>{ completed, results } | null</code></summary>

<br>

```js
const result = await api.openForceCheckCard(options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `opts`** | | | |
| <kbd>tokenA</kbd> | `Token` | `null` | Caster for the pickers' range pulse |
| <kbd>skill</kbd> | `string` | `"HULL"` | Stat every target rolls: `HULL` / `AGI` / `SYS` / `ENG` |
| <kbd>range</kbd> | `number` | `null` | Preset range on the target picker |
| <kbd>saveVs</kbd> | `Token\|Actor` | `null` | Save target. Empty = plain check |
| <kbd>targets</kbd> | `Token[]` | `null` | Pre-picked rollers |
| <kbd>sendToOwner</kbd> | `boolean` | `true` | Route each roll to its token owner |
| <kbd>accuracy</kbd> / <kbd>difficulty</kbd> / <kbd>flatModifier</kbd> | `number \| ((rollerToken: Token) => number)` | `0` | Pre-fill each roller's HASE HUD |

Card to force HASE checks: targets pick like an attack roll, the save target like a stat-roll save. Returns the [`executeForceCheck`](API_COMBAT.md) result, or `null` if cancelled.

```js
const result = await api.openForceCheckCard({ tokenA: casterToken, skill: 'ENG', range: 5, saveVs: casterToken });
```

</details>

<details id="startChoiceCard">
<summary><b><code>startChoiceCard</code></b> <sup>async</sup> → <code>{ choiceIdx, responderIds } | null</code></summary>

<br>

```js
await api.startChoiceCard(options)
```

Presents a choice card to the user (or GM) with custom buttons and callbacks.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
| <kbd>mode</kbd> | `string` | `"or"` | `"or"` (pick one), `"and"` (confirm all), `"vote"` (live tally), `"vote-hidden"` (hidden tally) |
| <kbd>choices</kbd> | `Array<Object>` | `[]` | List of choice objects (see below) |
| <kbd>title</kbd> | `string` | `"CHOICE"` | Card header |
| <kbd>description</kbd> | `string` | `""` | Subtitle text |
| <kbd>icon</kbd> | `string` | `null` | FontAwesome class |
| <kbd>headerClass</kbd> | `string` | `""` | Optional CSS class |
| <kbd>userIdControl</kbd> | `string\|string[]\|null` | `null` | User IDs for broadcast/vote targets |
| <kbd>originToken</kbd> | `Token` | `null` | Token the card is attributed to |
| <kbd>relatedToken</kbd> | `Token` | `null` | Second token shown on the card |
| <kbd>item</kbd> | `Item` | `null` | Source item shown on the card |
| <kbd>traceData</kbd> | `Object` | `null` | Trigger data carried through for tracing |
| <kbd>forceSocket</kbd> | `boolean` | `false` | Always route through the socket, even for the local user |
| <kbd>urgent</kbd> | `boolean` | `false` | Show immediately instead of waiting in the card queue |

**Choice Object:**
```js
{ text: "Label", icon: "fas fa-check", data: { id: 1 }, callback: async (data) => { ... } }
```

For vote modes, `userIdControl` must be a non-empty array of user IDs. The creator sees all votes and confirms the winner.

</details>

<details id="openChoiceMenu">
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

<details id="startVoteCard">
<summary><b><code>startVoteCard</code></b> <sup>async</sup> → <code>true | null</code></summary>

<br>

```js
const done = await api.startVoteCard(options)
```

Every listed voter gets a card and casts one choice. Only the caller sees the tally and can confirm to close the vote. Resolves `true` on confirm, `null` if dismissed.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
| <kbd>choices</kbd> | `Array<{ text, icon?, callback?, data? }>` | `[]` | The options voters pick from |
| <kbd>title</kbd> | `string` | card default | Card header |
| <kbd>description</kbd> | `string` | `""` | Subtitle text |
| <kbd>icon</kbd> | `string` | none | FontAwesome class |
| <kbd>headerClass</kbd> | `string` | `""` | Extra CSS class |
| <kbd>userIdControl</kbd> | `string\|string[]\|null` | `null` | Voter user IDs |
| <kbd>hidden</kbd> | `boolean` | `false` | Voters cannot see each other's counts |

```js
await api.startVoteCard({
    title: 'NEXT MISSION',
    choices: [{ text: 'Assault' }, { text: 'Recon' }],
    userIdControl: game.users.filter(u => !u.isGM).map(u => u.id)
});
```

</details>

<details id="confirmCard">
<summary><b><code>confirmCard</code></b> <sup>async</sup> → <code>boolean</code><br><b><code>askCard</code></b> <sup>async</sup> → <code>{ confirmed, responderIds }</code><br><b><code>pickCard</code></b> <sup>async</sup> → <code>entry | null</code></summary>

<br>

```js
const ok = await api.confirmCard({ title, description, confirmText, confirmIcon, ... })
const ask = await api.askCard({ title, description, yesText, noText, owner, ... })
const entry = await api.pickCard(entries, { label, entryIcon, title, description, ... })
```

Sugar over `startChoiceCard`. Extra options (`originToken`, `relatedToken`, `item`, `userIdControl`, ...) pass through.

`confirmCard` shows a single button (`confirmText`, default `"Confirm"`). Resolves `true` when clicked, `false` on dismiss.

`askCard` shows two buttons (`yesText`/`noText`, default `"Use"`/`"Skip"`, plus `yesIcon`/`noIcon`). `owner` (a Token) routes control to that token's owner with active-GM fallback. An explicit `userIdControl` wins. The interrupt `preConfirm` shape: `return (await api.askCard({...})).confirmed`.

`pickCard` maps `entries` to buttons and resolves the picked entry (dismiss = `null`).

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
| <kbd>confirmText</kbd> | `string` | `"Confirm"` | `confirmCard` button label |
| <kbd>confirmIcon</kbd> | `string` | `null` | `confirmCard` button icon |
| <kbd>yesText</kbd> / <kbd>noText</kbd> | `string` | `"Use"` / `"Skip"` | `askCard` button labels |
| <kbd>yesIcon</kbd> / <kbd>noIcon</kbd> | `string` | `null` | `askCard` button icons |
| <kbd>owner</kbd> | `Token` | `null` | Routes control to that token's owner, active-GM fallback. An explicit `userIdControl` wins |
| <kbd>label</kbd> | `string\|(entry) => string` | `entry.name` | `pickCard` button text: property name or function |
| <kbd>entryIcon</kbd> | `string\|(entry) => string` | `null` | `pickCard` button icon: fixed or per entry |

```js
const { confirmed } = await api.askCard({ title: 'BRACE?', yesText: 'Brace', noText: 'Pass', owner: reactorToken });
```

</details>

<details id="rollCard">
<summary><b><code>rollCard</code></b> <sup>async</sup> → <code>{ total, formula, roll } | null</code></summary>

<br>

```js
const result = await api.rollCard({ title, roll, originToken, relatedToken, item })
```

Card with an editable roll input (preset by `roll`, default `"1d20"`); rolls to chat as `originToken`. `null` on cancel.

```js
const result = await api.rollCard({ title: "REBOUND", roll: "1d6", originToken: reactorToken, item });
```

</details>

## Zones & Templates

<details id="placeZone">
<summary><b><code>placeZone</code></b> <sup>async</sup> → <code>Array&lt;MeasuredTemplate&gt;</code></summary>

<br>

```js
await api.placeZone(casterToken, options)
```

`casterToken` is the range-measurement origin.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
| <kbd>range</kbd> | `number` | `null` | Max range highlight |
| <kbd>rangeOrigin</kbd> | `{x, y}\|Token` | `null` | Override the range-measurement origin |
| <kbd>los</kbd> | `boolean` | `true` | Range highlight clipped by line of sight. Needs the `rangePulseLos` setting |
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
| <kbd>preset</kbd> | `string` | `null` | Template Macro library preset (name or id): its graphics and actions become the zone's base look |
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
placeZone(token, { size: 2, dangerous: { damageType: "kinetic", damageValue: 5 } });

placeZone(token, { size: 2, statusEffects: ["impaired", "lockon"] });

placeZone(token, { size: 2, difficultTerrain: { movementPenalty: 1, isFlatPenalty: true } });

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

<details id="tokensInTemplate">
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

## Placement & Movement

<details id="placeToken">
<summary><b><code>placeToken</code></b> <sup>async</sup> → <code>Promise&lt;Array&lt;TokenDocument&gt;|null&gt;</code></summary>

<br>

```js
await api.placeToken(options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
| <kbd>actor</kbd> | `Actor\|Array<Actor>\|Array<{actor, extraData}>` | `null` | Single Actor, Array of Actors, or Array of `{actor, extraData}`. Array shows selector. |
| <kbd>range</kbd> | `number` | `null` | Placement range |
| <kbd>los</kbd> | `boolean` | `true` | Placement range clipped and checked by line of sight. Needs the `rangePulseLos` setting |
| <kbd>count</kbd> | `number` | `1` | Total tokens to place |
| <kbd>extraData</kbd> | `Object` | `{}` | Default token data overrides. Flags are shallow-merged with prototype flags. |
| <kbd>origin</kbd> | `Token\|{x: number, y: number}` | `null` | Measurement origin |
| <kbd>onSpawn</kbd> | `(newTokenDoc: TokenDocument, origin: Token) => void \| Promise<void>` | `null` | `(newTokenDoc, origin) => {}` |
| <kbd>title</kbd> | `string` | `"PLACE TOKEN"` | Card header |
| <kbd>noCard</kbd> | `boolean` | `false` | Skip info card |
| <kbd>disposition</kbd> | `number` | `null` | Token disposition override |
| <kbd>team</kbd> | `string` | `null` | token-factions team override |
| <kbd>elevation</kbd> | `number` | `null` | Placement elevation |

```js
await api.placeToken({ actor: turretActor, origin: casterToken, range: 2 });
```

</details>

<details id="moveToken">
<summary><b><code>moveToken</code></b> <sup>async</sup> → <code>TokenDocument | null</code></summary>

<br>

```js
await api.moveToken(token, options)
```

Without `destination`, opens the drag-ruler picker: Ctrl+click waypoints, right-click removes, Confirm commits. Accepts a token array.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>token</kbd> | `Token` | *required* | The token to move |
| **inside `options`** | | | |
| <kbd>destination</kbd> | `{x: number, y: number}` | `null` | Center point (world coords), snapped to the grid. If omitted, interactive picker. |
| <kbd>teleport</kbd> | `boolean` | `false` | Move as the `blink` action (teleport animation, recorded as teleport) |
| <kbd>action</kbd> | `string` | `null` | Movement action key (see below). Animates the move as that type, forced (ignores walls/cost). Takes precedence over `teleport`. |
| <kbd>range</kbd> | `number` | `-1` | Max movement budget (interactive mode), soft warning only |
| <kbd>cost</kbd> | `number` | `null` | Fixed movement cost recorded instead of the measured one |
| <kbd>free</kbd> | `boolean` | `false` | Interactive mode: free movement, no cap consumption, involuntary |
| <kbd>urgent</kbd> | `boolean` | `false` | Interactive mode: jump the card queue |
| <kbd>canBeBlocked</kbd> | `boolean` | `false` | Direct mode: stop the move before blocking token bodies |
| <kbd>title</kbd> | `string` | `"TELEPORT"` / `"MOVE"` | Card header (interactive mode). Defaults to TELEPORT when `teleport` is on |
| <kbd>description</kbd> | `string` | `"Select destination."` | Card description |
| <kbd>icon</kbd> | `string` | none | FontAwesome class for the card |
| <kbd>headerClass</kbd> | `string` | `""` | Extra CSS class on the card header |

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

```js
await api.moveToken(token, { teleport: true, range: 5 });
```

</details>

<details id="boostMove">
<summary><b><code>boostMove</code></b> <sup>async</sup> → <code>TokenDocument | null</code></summary>

<br>

```js
await api.boostMove(token, options)
```

Triggers the Boost action, then `moveToken` with that speed. `options` pass through.

</details>

<details id="knockBackToken">
<summary><b><code>knockBackToken</code></b> <sup>async</sup> → <code>Array | null</code></summary>

<br>

```js
await api.knockBackToken(tokens, distance, options)
```

Knockback with the drag-ruler picker: plan a destination per token, Confirm commits all as forced moves (`onInvoluntaryMove` fires per token).

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>tokens</kbd> | `Token \| Token[]` | *required* | Tokens to knock back |
| <kbd>distance</kbd> | `number` | *required* | Knockback distance in spaces (-1 = unlimited) |
| **inside `options`** | | | |
| <kbd>title</kbd> | `string` | `"KNOCKBACK"` | Card header |
| <kbd>description</kbd> | `string` | `"Select destination for each token."` | Card description |
| <kbd>triggeringToken</kbd> | `Token` | `null` | The token causing the move (for `onInvoluntaryMove` trigger) |
| <kbd>actionName</kbd> | `string` | `""` | Source action name (enables `onlyOnSourceMatch`) |
| <kbd>item</kbd> | `Item` | `null` | Source item |
| <kbd>asVoluntary</kbd> | `boolean` | `false` | If true, moves go through the voluntary path (`onPreMove`/`onMove` fire, no `onInvoluntaryMove`). |
| <kbd>setElevation</kbd> | `boolean` | `false` | Set destination elevation from the terrain under it |
| <kbd>icon</kbd> | `string` | none | FontAwesome class for the card |
| <kbd>headerClass</kbd> | `string` | `""` | Extra CSS class on the card header |
| <kbd>urgent</kbd> | `boolean` | `true` | Pass `false` to wait in the card queue |

```js
await api.knockBackToken([target], 3, { triggeringToken: reactorToken });
```

</details>

<details id="revertMovement">
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

```js
await api.revertMovement(token, { x: 1200, y: 800 });
```

</details>


---

## Deployables & Thrown Weapons

<details id="addExtraDeploymentLids">
<summary><b><code>addExtraDeploymentLids</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code><br><b><code>addExtraDeploymentActor</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code><br><b><code>removeExtraDeploymentActor</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code><br><b><code>getActorDeployables</code></b> → <code>string[]</code><br><b><code>getLinkedDeployables</code></b> → <code>string[]</code></summary>

<br>

```js
await api.addExtraDeploymentLids(target, lids)
await api.addExtraDeploymentActor(target, actors)
await api.removeExtraDeploymentActor(target, actors)
api.getActorDeployables(tokenOrActor)
api.getLinkedDeployables(source)   // Item/Actor/Token, combined LIDs+UUIDs
```

**Params (read side):** <kbd>tokenOrActor</kbd> / <kbd>source</kbd> `Item|Actor|Token`

Item / Actor / Token target. Item stores on itself. Token/Actor stores on the actor. Both feed `getItemDeployables`, and `getActorDeployables` applies the tier gate with the actor as owner.

**NPC tier:** gate each entry inline - `addExtraDeploymentLids(item, [{ lid, tier: 1 }, { lid, tier: 2 }, ...])` - or separately via `setExtraDeployableOpts(target, key, { tier })` (1-3, unset = all tiers). Legacy: with no explicit tiers, 3 LIDs on an NPC still read positionally as T1/T2/T3.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>target</kbd> | `Item\|Actor\|Token` | Holder |
| <kbd>lids</kbd> | `string\|Array<string\|{lid,tier?,range?,count?}>` | LID(s), or `{ lid, ...opts }` to gate/size each inline |
| <kbd>actors</kbd> | `Actor\|string\|Array<Actor\|string>` | Actor doc(s) or UUID(s) |

```js
await api.addExtraDeploymentLids(actor, ['dep_turret_drone']);
```

</details>

<details id="getExtraDeployableOpts">
<summary><b><code>getExtraDeployableOpts</code></b> → <code>{ range?: number; count?: number; tier?: 1 | 2 | 3 } | null</code><br><b><code>setExtraDeployableOpts</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code></summary>

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

```js
await api.setExtraDeployableOpts(actor, 'dep_turret_drone', { count: 2, range: 3 });
```

</details>

<details id="setHidePrimaryAction">
<summary><b><code>setHidePrimaryAction</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code><br><b><code>isPrimaryActionHidden</code></b> → <code>boolean</code></summary>

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

`isPrimaryActionHidden` takes the `item` doc.

```js
await api.setHidePrimaryAction(item, true);
```

</details>

<details id="promptLinkOrUnlinkActor">
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

<details id="getItemDeployables">
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

<details id="placeDeployable">
<summary><b><code>placeDeployable</code></b> <sup>async</sup> → <code>Promise&lt;Object|null&gt;</code></summary>

<br>

```js
await api.placeDeployable(options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
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
| <kbd>elevationOffset</kbd> | `number` | `deployElevationOffset` flag, else `0` | Added to the ground elevation at the placement |

```js
await api.placeDeployable({ deployable: 'dep_turret_drone', ownerActor: actor, range: 2 });
```

</details>

<details id="beginDeploymentCard">
<summary><b><code>beginDeploymentCard</code></b> <sup>async</sup> → <code>Promise&lt;boolean&gt;</code><br><b><code>deployWeaponToken</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code></summary>

<br>

```js
await api.beginDeploymentCard({ actor, item, deployableOptions: [] })
await api.deployWeaponToken(weapon, ownerActor, originToken, options)
```

`beginDeploymentCard` resolves all deployable LIDs on an item and opens a `placeDeployable` session with an actor selector. `deployWeaponToken` deploys a weapon as a token on the map, for thrown weapons.

**`beginDeploymentCard` options:**

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
| <kbd>actor</kbd> | `Actor` | *required* | Owner of the deployables |
| <kbd>item</kbd> | `Item` | `null` | Item whose deployable LIDs are resolved |
| <kbd>deployableOptions</kbd> | `Array` | `[]` | Pre-resolved deployable entries, skipping LID lookup |

**`deployWeaponToken` positional args:** <kbd>weapon</kbd> `Item` · <kbd>ownerActor</kbd> `Actor` · <kbd>originToken</kbd> `Token`

**`deployWeaponToken` options:**

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| **inside `options`** | | | |
| <kbd>range</kbd> | `number` | `1` | Placement range |
| <kbd>at</kbd> | `Token\|Object` | `null` | Measurement origin |
| <kbd>title</kbd> | `string` | card default | Card header |
| <kbd>description</kbd> | `string` | card default | Card description |

```js
await api.beginDeploymentCard({ actor, item });
```

</details>

<details id="openDeployableMenu">
<summary><b><code>openDeployableMenu</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code><br><b><code>recallDeployable</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code><br><b><code>pickupWeaponToken</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code><br><b><code>openThrowMenu</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code><br><b><code>openItemBrowser</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code></summary>

<br>

```js
await api.openDeployableMenu(actor)      // open deployable management menu
await api.recallDeployable(ownerToken)    // recall a deployed token
await api.pickupWeaponToken(ownerToken)   // pick up a thrown weapon token
await api.openThrowMenu(actor)            // open throw weapon menu
await api.openItemBrowser(targetInput)    // open item browser
```

`openThrowMenu(actor?)` defaults to the controlled token's actor. `recallDeployable`/`pickupWeaponToken` take the owner token (`ownerToken`). `openItemBrowser(targetInput)` fills a jQuery input with the picked item and returns its LID.

</details>

---

## Hard Cover

<details id="spawnHardCover">
<summary><b><code>spawnHardCover</code></b> <sup>async</sup> → <code>Array&lt;TokenDocument&gt; | null</code></summary>

<br>

```js
await api.spawnHardCover(originToken, options)
```

Spawns hard cover deployable tokens on the map.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>originToken</kbd> | `Token` | *required* | Measurement origin |
| **inside `options`** | | | |
| <kbd>range</kbd> | `number` | `null` | Placement range |
| <kbd>count</kbd> | `number` | `1` | Number of hard covers |
| <kbd>size</kbd> | `number` | `1` | Size override |
| <kbd>name</kbd> | `string` | `"Hard Cover"` | Display name |
| <kbd>title</kbd> | `string` | `"PLACE HARD COVER"` | Card header |
| <kbd>description</kbd> | `string` | `""` | Card description |

```js
await api.spawnHardCover(casterToken, { count: 2, range: 3, name: 'Rampart Wall' });
```

</details>

---

## Reinforcements

<details id="delayedTokenAppearance">
<summary><b><code>delayedTokenAppearance</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code></summary>

<br>

```js
await api.delayedTokenAppearance()
```

Hides the currently selected tokens and schedules their arrival: pick the round, and they appear at its start with FX. Needs an active combat and at least one controlled token. The `L.A - Reinforcement` macro is this call.

</details>
