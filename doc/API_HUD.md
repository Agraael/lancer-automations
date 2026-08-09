# API - Token Action HUD

[Back to API Reference](API_REFERENCE.md) · Feature guide: [Token Action HUD](feature/HUD.md)

---

## Extra Actions

Inject actions onto items or actors, drive their charge / limited state, and lock native actions. Everything here shows up in the TAH action menu.

<details>
<summary><b><code>addExtraActions</code></b> <sup>async</sup> · <b><code>getItemActions</code></b> · <b><code>getActorActions</code></b> · <b><code>getLinkedActions</code></b> · <b><code>removeExtraActions</code></b> <sup>async</sup></summary>

<br>

```js
await api.addExtraActions(target, actions)       // add to Item, Token, or Actor
api.getItemActions(item)                          // → Object[] (system.actions + extras)
api.getActorActions(tokenOrActor)                 // → Object[] (extras on actor/item)
api.getLinkedActions(source)                      // same, Item/Actor/Token uniformly
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
| `damage`, `range` | `Array<{val,type}>` | Same shape as system actions. Consumed in combat mode |
| `mech`, `pilot` | `boolean` | Visibility gates |
| `tags` | `Array<{lid,val}>` | Standard Lancer tags. Weapon tags (`tg_smart` etc.) coexist with consumable tags |
| `icon` | `string` | TAH icon override (path or FontAwesome class) |
| `recharge`, `charged` | `number`, `boolean` | Charge state for `tg_recharge` actions |
| `uses` | `{value,max}` | Charge state for `tg_limited` actions |
| `tier` | `1\|2\|3` | Gate to an NPC owner tier; unset = any tier. Non-NPC owners ignore it |
| `laCombat` | `'attack'\|'damage'` | Turn the action into an attack or damage roll (see below). Absent = plain card |
| `accuracy`, `difficulty`, `attack_bonus` | `number` | Combat attack: flat accuracy/difficulty dice + flat to-hit bonus |
| `attack_type` | `'Melee'\|'Ranged'` | Combat attack: melee vs ranged |

Item-held actions appear under their item in the TAH menu, actor-held actions in the actor's action list. No refresh needed.

**`laCombat` mode:** stays in its activation column; clicking prints the card then fires [`executeExtraActionCombat`](API_COMBAT.md). `'attack'` rolls a to-hit (weapon tags apply; `tg_smart` = E-DEF; `Invade`/`Quick Tech`/`Full Tech` = tech attack at Sensors). `'damage'` rolls `damage` with no to-hit.

**Auto-behaviors when target is an Item:**
- `_sourceItemId` is stamped onto every added action so [`onlyOnSourceMatch`](AUTOMATION_SYSTEM.md) reactions can resolve the parent item.
- If the action carries a consumable tag (`tg_loading` / `tg_recharge` / `tg_limited`) that's already on the parent item, that tag is stripped from the action along with its state field (`loaded` / `charged`+`recharge` / `uses`). A warning is shown. Item-level state stays authoritative.

**Example:**
```js
await api.addExtraActions(myItem, { name: "Suppressive Fire", activation: "Quick", detail: "..." });
await api.removeExtraActions(myToken, "Custom Strike");
// combat extra in one call
await api.addExtraActions(actor, { name: "Plasma Lance", activation: "Quick", laCombat: "attack",
  tags: [{ lid: "tg_smart" }], damage: [{ val: "2d6", type: "Energy" }], range: [{ type: "Range", val: 10 }] });
```

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
<summary><b><code>lockActorAction</code></b> <sup>async</sup> · <b><code>unlockActorAction</code></b> <sup>async</sup> · <b><code>isActionLocked</code></b> · <b><code>getLockedActions</code></b></summary>

<br>

```js
await api.lockActorAction(item, actionName, { reason? })          // lock held BY the item
await api.lockActorAction(actor, actionName, sourceId, { reason? }) // manual actor lock
await api.unlockActorAction(target, actionName, sourceId?)        // sourceId only for actor locks
api.isActionLocked(actor, actionName)        // → boolean (manual + item locks)
api.getLockedActions(actor)                  // → string[]
```

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>target</kbd> | `Item\|Actor\|Token` | Item: lock lives on the item - off while destroyed/disabled, gone when removed, back on repair. Actor: source-tracked manual lock. |
| <kbd>actionName</kbd> | `string` | Standard action display name (`"Boost"`, `"Grapple"`, ...) |
| <kbd>sourceId</kbd> | `string` | Actor locks only. Stays locked until every source is removed. |
| <kbd>reason</kbd> | `string` | Optional. Shown in the popup's "Locked by:" line (item locks default to the item name). |

Locked actions are grayed in TAH; the action popup names the locker (status, item, or reason).

```js
onInit: async function (token, item, api) {
    await api.lockActorAction(item, "Boost");
    await api.addExtraActions(item, { name: "Boost (Industrial)", activation: "Full", detail: "..." });
}
```

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
