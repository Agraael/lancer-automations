# API - Token Display

[Back to API Reference](API_REFERENCE.md) · Feature guide: [Custom Token Stat Bars](feature/TOKEN_DISPLAY.md)

---

## Extra Stat Bars

Extra bars drawn under a token's HP/Heat/etc. All four functions accept **Token, Item, or Actor** as the target. The first three also take a uuid or id string, `getExtraBars` needs the document itself.

| Target | Storage | Lifecycle |
|:-------|:--------|:----------|
| `Token` | `token.flags.lancer-automations.statBarExtras` | Dies with the token |
| `Item` | `item.flags.lancer-automations.extraBarTemplates` | Auto-injects onto every scene token of the item's actor |
| `Actor` | `actor.flags.lancer-automations.extraBarTemplates` | Auto-injects onto every scene token of the actor |

A token holds finished entries, an Item or Actor holds templates, so the same call does different work:

| | Token target | Item / Actor target |
|:--|:--|:--|
| `addExtraBar` | Overlays `partial` on the full default entry | Stores only the fields you passed, seeding `valueSource` / `maxSource` as manual. The rest fills in at inject time |
| `updateExtraBarValue` | Manual entries only, path-bound ones are read-only | Manual templates mutate and reinject, path templates write through the path with `.update()` |
| `removeExtraBar` | Drops the entry | Drops the template, then prunes its injected rows from every scene token of the actor |

<details id="addExtraBar">
<summary><b><code>addExtraBar</code></b> <sup>async</sup> → <code>string | null</code></summary>

<br>

```js
const id = await api.addExtraBar(target, partial)
```

Create a new extra bar. Token target: `partial` overlays the default shape below, and the entry id comes back. Item/Actor target: the template keeps only the fields you passed, with `valueSource` and `maxSource` seeded to `{ kind: 'manual' }` when you leave them out, and the template id comes back. Either way the default is `visibility: 'scanned'` (bar shows once the token is [scanned](feature/GAMEPLAY_AUTOMATION.md#scan)).

A template gets the default shape only when it is injected onto a token, so `addExtraBar(item, {})` produces a manual 0/1 bar, not a copy of the HP bar. Fields the template left out are filled from the auto-inject world settings (width, color, audio feedback) before the default shape.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>target</kbd> | `Token \| TokenDocument \| Item \| Actor \| string` | *required* | Document (or uuid/id) |
| <kbd>partial</kbd> | `object` | `{}` | Fields of the entry (see shape below) |

Entry shape (all fields optional in `partial`):

```js
{
    id: string,                    // auto-generated if missing
    label: string,                 // short tag, e.g. "AP"
    layoutMode: 'newLine' | 'sameLine',
    widthPct: number,              // 1..100
    valueSource: { kind: 'path' | 'manual', path?: string, value?: number },
    maxSource:   { kind: 'path' | 'manual', path?: string, value?: number },
    segmented: boolean,            // draw as pips, one per unit of the resolved max
    segments: number,              // default 4, the pip count used when the max resolves to 0
    color: { kind: 'solid', stops: ['#RRGGBB'] },
    visibility: 'owner' | 'scanned' | 'all',
    icon: string,                  // file path
    showLabelInHint: boolean,      // show label in the hover stat hint
    audioTextFeedback: boolean,    // default true, play the value-change sound and text
    linkedItemUuid: string,        // right-click in TAH opens this item's sheet
    tier: 1 | 2 | 3,               // gate to an NPC owner tier, unset = any
}
```

`valueSource.path` / `maxSource.path` read off the actor. Two prefixes redirect that:
- `items.{itemId}.X`: reads from `actor.items.get(itemId)`
- `pilotItems.{itemId}.X`: reads from the actor's pilot, falling back to the actor's own items when there is no pilot

Any other path is read straight off the actor document, so `system.hp.value` works and so does any other actor-rooted path.

</details>

<details id="updateExtraBarValue">
<summary><b><code>updateExtraBarValue</code></b> <sup>async</sup> → <code>number | null</code></summary>

<br>

```js
const newVal = await api.updateExtraBarValue(target, entryId, value)
```

Token target: only **manual** entries can be updated. Path-bound entries are read-only, except a custom-flag bar (its `autoKey` starts with `flag:`), which writes the value through to the alt-sheets flag. Item/Actor target: manual templates mutate their value and reinject. Path templates write through the resolved path via `.update()`.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>target</kbd> | `Token \| TokenDocument \| Item \| Actor \| string` | *required* | Document (or uuid/id) |
| <kbd>entryId</kbd> | `string` | *required* | The entry / template id |
| <kbd>value</kbd> | `number \| string` | *required* | A number, numeric string, or delta string (`"+2"` / `"-3"`) |

```js
await api.updateExtraBarValue(token, entryId, '-1');
```

</details>

<details id="removeExtraBar">
<summary><b><code>removeExtraBar</code></b> <sup>async</sup> → <code>boolean</code></summary>

<br>

```js
const ok = await api.removeExtraBar(target, entryId)
```

Remove an entry (Token) or template (Item/Actor) by id. Item/Actor removal also prunes matching auto-injected rows from every scene token of the actor.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>target</kbd> | `Token \| TokenDocument \| Item \| Actor \| string` | *required* | Document (or uuid/id) |
| <kbd>entryId</kbd> | `string` | *required* | The entry / template id |

```js
await api.removeExtraBar(token, entryId);
```

</details>

<details id="getExtraBars">
<summary><b><code>getExtraBars</code></b> → <code>Array</code></summary>

<br>

```js
const entries = api.getExtraBars(target)
```

List the extra bars / templates on a target. Token → entries in `statBarExtras`. Item/Actor → template records `[{ id, entry }]`.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>target</kbd> | `Token \| TokenDocument \| Item \| Actor` | *required* | Document |

```js
const entryId = api.getExtraBars(token)[0]?.id;
```

</details>
