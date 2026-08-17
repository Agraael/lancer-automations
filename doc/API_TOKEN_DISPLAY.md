# API - Token Display

[Back to API Reference](API_REFERENCE.md) · Feature guide: [Custom Token Stat Bars](feature/TOKEN_DISPLAY.md)

---

## Extra Stat Bars

Extra bars drawn under a token's HP/Heat/etc. All four functions accept **Token, Item, or Actor** as the target:

| Target | Storage | Lifecycle |
|:-------|:--------|:----------|
| `Token` | `token.flags.lancer-automations.statBarExtras` | Dies with the token |
| `Item` | `item.flags.lancer-automations.extraBarTemplates` | Auto-injects onto every scene token of the item's actor |
| `Actor` | `actor.flags.lancer-automations.extraBarTemplates` | Auto-injects onto every scene token of the actor |

<details id="addExtraBar">
<summary><b><code>addExtraBar</code></b> <sup>async</sup> → <code>string | null</code></summary>

<br>

```js
const id = await api.addExtraBar(target, partial)
```

Create a new extra bar by overlaying `partial` on the default shape. Token target returns the entry id. Item/Actor target returns the template id. Defaults to `visibility: 'scanned'` (bar shows once the token is [scanned](feature/GAMEPLAY_AUTOMATION.md#scan)).

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>target</kbd> | `Token \| TokenDocument \| Item \| Actor \| string` | *required* | Document (or uuid/id) |
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
    visibility: 'owner' | 'scanned' | 'all',
    icon: string,                  // file path
    showLabelInHint: boolean,      // show label in the hover stat hint
    linkedItemUuid: string,        // right-click in TAH opens this item's sheet
    tier: 1 | 2 | 3,               // gate to an NPC owner tier; unset = any
}
```

`valueSource.path` / `maxSource.path` understand three prefixes:
- `system.X`: reads from the actor
- `items.{itemId}.X`: reads from `actor.items.get(itemId)`
- `pilotItems.{itemId}.X`: reads from the pilot's items when the actor is a mech

</details>

---

<details id="updateExtraBarValue">
<summary><b><code>updateExtraBarValue</code></b> <sup>async</sup> → <code>number | null</code></summary>

<br>

```js
const newVal = await api.updateExtraBarValue(target, entryId, value)
```

Token target: only **manual** entries can be updated. Path-bound entries are read-only. Item/Actor target: manual templates mutate their value and reinject. Path templates write through the resolved path via `.update()`.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>target</kbd> | `Token \| TokenDocument \| Item \| Actor \| string` | *required* | Document (or uuid/id) |
| <kbd>entryId</kbd> | `string` | *required* | The entry / template id |
| <kbd>value</kbd> | `number \| string` | *required* | A number, numeric string, or delta string (`"+2"` / `"-3"`) |

```js
await api.updateExtraBarValue(token, entryId, '-1');
```

</details>

---

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

---

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
