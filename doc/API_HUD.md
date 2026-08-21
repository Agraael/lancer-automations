# API - Token Action HUD

[Back to API Reference](API_REFERENCE.md) · Feature guide: [Token Action HUD](feature/HUD.md)

---

## Extra Actions

Inject actions onto items or actors, drive their charge / limited state, lock native actions, and overlay combat data onto native actions. Everything here shows up in the TAH action menu.

<details id="addExtraActions">
<summary><b><code>addExtraActions</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code><br><b><code>getItemActions</code></b> → <code>object[]</code><br><b><code>getActorActions</code></b> → <code>object[]</code><br><b><code>getLinkedActions</code></b> → <code>any[]</code><br><b><code>removeExtraActions</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code></summary>

<br>

```js
await api.addExtraActions(target, actions)       // add to Item, Token, or Actor
api.getItemActions(item)                          // → Object[] (system.actions + extras)
api.getActorActions(tokenOrActor)                 // → Object[] (extras on actor/item)
api.getLinkedActions(source)                      // same, Item/Actor/Token uniformly
await api.removeExtraActions(target, filter?)     // string name, predicate, or null (clear all)
```

**Params (read side):** <kbd>source</kbd> `Item|Actor|Token`

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>target</kbd> | `Item\|Token\|Actor` | Item stores on itself. Token/Actor stores on the actor |
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
| `tier` | `1\|2\|3` | Gate to an NPC owner tier. Unset = any tier. Non-NPC owners ignore it |
| `laCombat` | `'attack'\|'damage'` | Turn the action into an attack or damage roll (see below). Absent = plain card |
| `accuracy`, `difficulty`, `attack_bonus` | `number` | Combat attack: flat accuracy/difficulty dice + flat to-hit bonus |
| `attack_type` | `'Melee'\|'Ranged'` | Combat attack: melee vs ranged |

Item-held actions appear under their item in the TAH menu, actor-held actions in the actor's action list. No refresh needed.

**`laCombat` mode:** stays in its activation column. Clicking prints the card then fires [`executeExtraActionCombat`](API_COMBAT.md). `'attack'` rolls a to-hit (weapon tags apply, `tg_smart` = E-DEF, `Invade`/`Quick Tech`/`Full Tech` = tech attack at Sensors). `'damage'` rolls `damage` with no to-hit.

**Auto-behaviors when target is an Item:**
- `_sourceItemId` is stamped onto every added action so [`onlyOnSourceMatch`](AUTOMATION_SYSTEM.md) reactions can resolve the parent item.
- If the action carries a consumable tag (`tg_loading` / `tg_recharge` / `tg_limited`) that's already on the parent item, that tag is stripped from the action along with its state field (`loaded` / `charged`+`recharge` / `uses`). A warning is shown. Item-level state stays authoritative.

**Example:**
```js
await api.addExtraActions(myItem, { name: "Suppressive Fire", activation: "Quick", detail: "..." });
await api.removeExtraActions(myToken, "Custom Strike");
await api.addExtraActions(actor, { name: "Plasma Lance", activation: "Quick", laCombat: "attack",
  tags: [{ lid: "tg_smart" }], damage: [{ val: "2d6", type: "Energy" }], range: [{ type: "Range", val: 10 }] });
```

</details>

<details id="consumeExtraAction">
<summary><b><code>consumeExtraAction</code></b> <sup>async</sup> → <code>Promise&lt;boolean&gt;</code><br><b><code>reloadExtraAction</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code><br><b><code>rechargeExtraActionsForActor</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code></summary>

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

```js
if (!await api.consumeExtraAction(item, 'Turret Shot')) return;
```

</details>

<details id="lockActorAction">
<summary><b><code>lockActorAction</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code><br><b><code>unlockActorAction</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code><br><b><code>isActionLocked</code></b> → <code>boolean</code><br><b><code>getLockedActions</code></b> → <code>string[]</code></summary>

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
| <kbd>actionName</kbd> | `string` | Standard action display name (`"Boost"`, `"Grapple"`, ...), or a weapon's name to grey that weapon's rows |
| <kbd>sourceId</kbd> | `string` | Actor locks only. Stays locked until every source is removed. |
| **inside `opts`** | | |
| <kbd>reason</kbd> | `string` | Optional. Shown in the popup's "Locked by:" line (item locks default to the item name). |

The third argument takes the `sourceId` string or an options object (`sourceIdOrOpts`). The trailing `kind` is an internal lock category used by the status system - leave it unset.

Locked actions are grayed in TAH. The action popup names the locker (status, item, or reason). Locking a weapon (item target, `actionName` = the weapon's name) grays the weapon row and its FIGHT / SKIRMISH / BARRAGE / ATTACK entries, with the reason in the weapon popup.

```js
onInit: async function (token, item, api) {
    await api.lockActorAction(item, "Boost");
    await api.addExtraActions(item, { name: "Boost (Industrial)", activation: "Full", detail: "..." });
}
```

</details>

<details id="lockActorActionTypes">
<summary><b><code>lockActorActionTypes</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code><br><b><code>unlockActorActionTypes</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code></summary>

<br>

```js
await api.lockActorActionTypes(target, activationTypes, sourceIdOrOpts?, opts?)
await api.unlockActorActionTypes(target, activationTypes?, sourceId?)
```

Locks by activation type rather than by name, so one call greys every Quick or Full action at once. Same target rules as `lockActorAction`: an item target holds the lock itself, an actor target is source-tracked.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>target</kbd> | `Item\|Actor\|Token` | *required* | Item holds the lock, actor is source-tracked |
| <kbd>activationTypes</kbd> | `string\|string[]` | *required* | Types to lock, e.g. `"Quick"` / `"Full"`. Omit on unlock to clear all |
| <kbd>sourceIdOrOpts</kbd> | `string\|Object` | `null` | Source id for later removal, or the options object itself |
| <kbd>opts.reason</kbd> | `string` | `null` | Shown in the popup's "Locked by:" line |

On unlock, pass the same `sourceId`. The trailing `kind` is internal - leave it unset.

```js
await api.lockActorActionTypes(actor, ['Quick', 'Full'], 'stunned', { reason: 'Stunned' });
await api.unlockActorActionTypes(actor, ['Quick', 'Full'], 'stunned');
```

</details>

<details id="disableActorAction">
<summary><b><code>disableActorAction</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code><br><b><code>enableActorAction</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code><br><b><code>disableActorActionTypes</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code><br><b><code>enableActorActionTypes</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code></summary>

<br>

```js
await api.disableActorAction(target, actionName, sourceIdOrOpts?, opts?)
await api.enableActorAction(target, actionName, sourceId?)
await api.disableActorActionTypes(target, activationTypes, sourceIdOrOpts?, opts?)
await api.enableActorActionTypes(target, activationTypes?, sourceId?)
```

Same arguments as `lockActorAction` / `lockActorActionTypes`, but the rows show yellow (like status-disabled actions) instead of grey - use disable for temporary states, lock for lasting ones. Disabled entries are tracked separately: `unlock*` never removes them, `enable*` only removes them.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>target</kbd> | `Actor\|Token` | *required* | Owner of the actions |
| <kbd>actionName</kbd> | `string` | *required* | Action to disable. `*Types` variants take `activationTypes` instead |
| <kbd>activationTypes</kbd> | `string\|string[]` | *required* | Activation types to disable, e.g. `"Quick"` / `"Full"` |
| <kbd>sourceIdOrOpts</kbd> | `string\|Object` | `null` | Source id for later removal, or the options object itself |
| <kbd>opts</kbd> | `Object` | `null` | Options when `sourceIdOrOpts` held the source id |
| <kbd>opts.reason</kbd> | `string` | `null` | Shown on the disabled row |

`enable*` takes `sourceId` in place of the last two: pass the same id used to disable, or omit to clear all.

```js
await api.disableActorAction(actor, 'Boost', 'overheat', { reason: 'Reactor venting' });
await api.enableActorAction(actor, 'Boost', 'overheat');
```

</details>

<details id="setActionOverlay">
<summary><b><code>setActionOverlay</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code><br><b><code>getActionOverlay</code></b> → <code>object | null</code><br><b><code>getActionOverlays</code></b> → <code>Record&lt;string, object&gt;</code><br><b><code>removeActionOverlay</code></b> <sup>async</sup> → <code>Promise&lt;any&gt;</code><br><b><code>applyActionOverlays</code></b> → <code>object[]</code><br><b><code>resolveGrantedActionRange</code></b> → <code>number | null</code></summary>

<br>

```js
await api.setActionOverlay(target, actionName, overlay)   // attach / patch; null removes
api.getActionOverlay(target, actionName)                  // → overlay | null
api.getActionOverlays(target)                             // → { [actionName]: overlay }
await api.removeActionOverlay(target, actionName)
api.applyActionOverlays(target, actions)                  // → actions with overlays folded in
api.resolveGrantedActionRange(actor, actionName, base?)   // → number | null
```

`resolveGrantedActionRange` takes the owning `actor`.

Combat data on an item's **native** actions (`system.actions`), stored in a flag so re-imports don't wipe it. The overlay merges onto the action at read time. Name / activation / detail are never touched. Activating the action anywhere (TAH, sheet, macro) prints the normal card, then rolls via [`executeExtraActionCombat`](API_COMBAT.md).

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>target</kbd> | `Item\|Token\|Actor` | Item that owns the action. Token/Actor for a deployable's own actions |
| <kbd>actionName</kbd> | `string` | Name as it appears in `system.actions`. Dots are safe |
| <kbd>overlay</kbd> | `Object\|null` | Combat fields below. Patch-merge. An empty value clears a field, `null` removes the overlay |

**Overlay fields:** `laCombat` (`'attack'|'damage'`), `attack_bonus`, `accuracy`, `difficulty`, `attack_type`, `tags`, `damage`, `range` - same semantics as the `ExtraAction` combat fields above. `laCombat` is optional: a `range`-only overlay just grants range.

**Range grants:** `resolveGrantedActionRange` folds every non-destroyed item's overlay `range` entries for that action onto `base`. Per-entry `mode` works like AE changes: `upgrade` (default, greater wins), `add` (sums, negatives allowed), `override` (hard set). Consumed by the Lock On automation (base = Sensors) and the TAH hover range pulse.

**Example:**
```js
await api.setActionOverlay(deployableActor, "Turret Attack (Auto)", {
  laCombat: "attack", attack_bonus: 2, attack_type: "Ranged",
  damage: [{ val: "5", type: "Kinetic" }] });
await api.setActionOverlay(item, "Lock On", { range: [{ type: "Range", val: 10 }] });
```

Managed from the UI via Add Extra > Action Combat.

</details>

<details id="openExtrasDialog">
<summary><b><code>openExtrasDialog</code></b> → <code>void</code></summary>

<br>

```js
api.openExtrasDialog(actor)
```

Dialog for managing actor-level extras (extra actions + extra deployment actors). Only lists entries created here. Also reachable via TAH > Utility > Misc > Add Extra.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>target</kbd> | `Actor\|Token` | Owner |

```js
api.openExtrasDialog(token.actor);
```

</details>
