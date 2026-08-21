# API - Combat & Weapons

[Back to API Reference](API_REFERENCE.md) · Feature guide: [Gameplay Automation](feature/GAMEPLAY_AUTOMATION.md)

---

## Attacks

<details id="attackWith">
<summary><b><code>attackWith</code></b> <sup>async</sup> → <code>Promise&lt;{ completed: boolean; flow?: any; reloaded?: boolean }&gt;</code><br><b><code>attackRollWith</code></b> <sup>async</sup> → <code>Promise&lt;{ completed: boolean; flow?: any }&gt;</code><br><b><code>hitWith</code></b> <sup>async</sup> → <code>Promise&lt;{ completed: boolean; flow?: any }&gt;</code><br><b><code>damageWith</code></b> <sup>async</sup> → <code>Promise&lt;{ completed: boolean; flow?: any }&gt;</code><br><b><code>getTier</code></b> → <code>number</code><br><b><code>tierValue</code></b> → <code>any</code><br><b><code>getFlowFlag</code></b> → <code>any</code><br><b><code>setFlowFlag</code></b> → <code>boolean</code><br><b><code>afterFlow</code></b> → <code>boolean</code><br><b><code>consumeOncePerRound</code></b> <sup>async</sup> → <code>Promise&lt;boolean&gt;</code></summary>

<br>

```js
await api.attackWith(weapon, targets?, { reloadIfEmpty?, fxSourceToken? })   // target + start the weapon attack flow
await api.attackRollWith(weapon, targets?, { fxSourceToken?, title? })       // repeat the weapon's attack roll only
await api.hitWith(weapon, targets, damageOptions?)                           // declare a hit: onHit trigger + the weapon's damage flow
await api.damageWith(weapon, targets?, damageOptions?)                       // the weapon's damage flow alone
api.getTier(tokenOrActor)                                     // → 1-3
api.tierValue(tokenOrActor, [t1, t2, t3])                     // → value for the actor's tier
api.getFlowFlag(triggerData, key)                             // read a la_extraData flag off the flow
api.setFlowFlag(triggerData, key, value?)                     // stamp it (once-per-flow gates)
api.afterFlow(triggerData, callback)                          // run callback after the trigger's flow completes
await api.consumeOncePerRound(owner, key, subject?)           // → true the first time this round
```

**Params:** <kbd>tokenOrActor</kbd> `Token|Actor` · <kbd>values</kbd> `[any, any, any]` per-tier values · <kbd>triggerData</kbd> the trigger's data object · <kbd>value</kbd> `any` (default `true`) · <kbd>reloadIfEmpty</kbd> `boolean` (default `false`) · <kbd>fxSourceToken</kbd> `Token` (default `null`) · <kbd>title</kbd> `string` card title override · <kbd>callback</kbd> `(flow, success) => any`

`attackWith` sets the given tokens as targets then starts the weapon's attack flow. `reloadIfEmpty: true` reloads instead and returns `{ reloaded: true }` when the weapon is unloaded. `fxSourceToken` plays the lancer-weapon-fx effect from that token instead of the attacker (the roll stays the attacker's) - reflected shots, turrets, drones.

`attackRollWith` repeats the weapon's attack roll as a basic attack with the weapon's stats (tier-resolved for NPC features) and carries its damage/tags to the damage roll, but skips the weapon-fire mechanics: no loading gate, no self-heat, no item updates. Rebound pattern.

The chain is attack > hit > damage: `attackWith` runs all three stages, `hitWith` the last two (fires `onHit` with the upcoming damage flow as its flowState, then rolls the weapon's damage), `damageWith` the last one. `damageOptions` override the damage flow data (defaults: the weapon's tier-resolved damage and tags).

`afterFlow` runs the callback once the trigger's flow completes or aborts, after its card printed - one-shot, matched to that exact flow. Use it for anything that must not interleave with the flow (follow-up attacks, moves).

`tierValue(reactorToken, [4, 6, 8])` replaces tier ladders and clamped index picks. Flow flags replace the hand-written `flowState.la_extraData = ... || {}; ..._key = true` stamp and its evaluate read.

`consumeOncePerRound` is the round-scoped version, for "first time in a round" rules.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>owner</kbd> | `Token \| Actor` | *required* | Holds the flag, usually the reactor |
| <kbd>key</kbd> | `string` | *required* | Name of the gate, e.g. `'ring_of_fire'` |
| <kbd>subject</kbd> | `Token \| Actor \| string \| null` | `null` | Counted separately per subject. Omit for one gate on the owner |

`true` on the first call this round, `false` after. Last round's flag is cleaned up for you, and out of combat it is always `true`.

```js
if (await api.consumeOncePerRound(reactorToken, 'ring_of_fire', target))
    await api.executeDamageRoll(reactorToken, [target], 2, 'Heat', 'Ring of Fire');
```

</details>

<details id="executeBasicAttack">
<summary><b><code>executeBasicAttack</code></b> <sup>async</sup> → <code>{completed, flow}</code></summary>

<br>

```js
await api.executeBasicAttack(actor, options, extraData)
```

Starts a `BasicAttackFlow`. The `options` object is passed directly to the flow constructor.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actor</kbd> | `Actor` | *required* | The actor making the attack |
| <kbd>extraData</kbd> | `Object` | `{}` | Injected into `state.la_extraData` |
| **inside `options`** | | | |
| <kbd>targets</kbd> | `Token\|Token[]` | `null` | Who is attacked. Avoids touching `setTarget` |
| <kbd>tags</kbd> | `Array` | `undefined` | Weapon tags carried onto the attack card |
| <kbd>damage</kbd> | `Array` | `undefined` | Damage list carried onto the card, so its damage button rolls pre-filled |

Any other key is forwarded to the `BasicAttackFlow` constructor.

```js
await api.executeBasicAttack(actor, {
    targets: targetToken,
    damage: [{ type: 'Energy', val: '1d6' }]
});
```

</details>

<details id="executeTechAttack">
<summary><b><code>executeTechAttack</code></b> <sup>async</sup> → <code>{completed, flow}</code></summary>

<br>

```js
await api.executeTechAttack(target, options, extraData)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>target</kbd> | `Actor\|Item` | *required* | The actor or item initiating the tech attack |
| <kbd>extraData</kbd> | `Object` | `{}` | Injected state data |
| **inside `options`** | | | |
| <kbd>targets</kbd> | `Token\|Token[]` | `null` | Who is attacked |
| <kbd>damage</kbd> | `Array` | `undefined` | Damage list carried onto the attack card |

Any other key is forwarded to the flow constructor.

```js
await api.executeTechAttack(actor, { targets: [target] });
```

</details>

<details id="executeSkirmish">
<summary><b><code>executeSkirmish</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.executeSkirmish(actorOrToken, bypassMount, preTarget, weaponFilter, opts)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actorOrToken</kbd> | `Actor\|Token\|TokenDocument` | *required* | The actor or token performing the skirmish |
| <kbd>bypassMount</kbd> | `Object` | `null` | Mount object to skip mount selection |
| <kbd>preTarget</kbd> | `Token` | `null` | Pre-selected target token |
| <kbd>weaponFilter</kbd> | `(weapon: Item) => boolean` | `null` | Filter for available weapons |
| <kbd>opts</kbd> | `Object` | `{}` | `noFX: true` skips the skirmish FX |

```js
await api.executeSkirmish(token, null, targetToken);
```

</details>

<details id="executeBarrage">
<summary><b><code>executeBarrage</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.executeBarrage(actorOrToken, bypassMount, preTarget)
```

Runs a Barrage: attacks with either two different mounts or one superheavy mount. Prompts for the mounts unless `bypassMount` supplies them.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actorOrToken</kbd> | `Actor\|Token\|TokenDocument` | *required* | The acting entity |
| <kbd>bypassMount</kbd> | `Object\|Array` | `null` | Mounts to use, skipping selection |
| <kbd>preTarget</kbd> | `Token` | `null` | Pre-targeted before each attack flow |

```js
await api.executeBarrage(token, null, targetToken);
```

</details>

<details id="executeInvade">
<summary><b><code>executeInvade</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code></summary>

<br>

```js
await api.executeInvade(actorOrToken, bypassChoice)
```

Prompts for one of the actor's invade options, then fires the tech attack flow.

**Params:** <kbd>actorOrToken</kbd> `Actor|Token` · <kbd>bypassChoice</kbd> `Object` preselected invade, skips the prompt

```js
await api.executeInvade(token);
```

</details>

<details id="beginWeaponAttackFlow">
<summary><b><code>beginWeaponAttackFlow</code></b> <sup>async</sup> → <code>{completed, flow?}</code></summary>

<br>

```js
await api.beginWeaponAttackFlow(weapon, options, extraData)
```

Starts a weapon attack flow for a given weapon item.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>weapon</kbd> | `Item` | *required* | The weapon item to attack with |
| <kbd>extraData</kbd> | `Object` | `{}` | Injected state data |
| **inside `options`** | | | |
| <kbd>targets</kbd> | `Token\|Token[]` | `null` | Who is attacked |

Any other key is forwarded to the flow constructor.

Pass `targets` rather than calling `setTarget` yourself.

```js
await api.beginWeaponAttackFlow(weapon, { targets: [target] });
```

</details>

<details id="executeDamageRoll">
<summary><b><code>executeDamageRoll</code></b> <sup>async</sup> → <code>{completed, flow}</code></summary>

<br>

```js
await api.executeDamageRoll(attacker, targets, damageValue, damageType, title, options, extraData)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>attacker</kbd> | `Token\|Actor` | *required* | The attacker |
| <kbd>targets</kbd> | `Array<Token>` | *required* | Damage targets |
| <kbd>damageValue</kbd> | `number\|string` | `null` | Base damage |
| <kbd>damageType</kbd> | `string` | `null` | kinetic, energy, explosive, burn, heat, variable |
| <kbd>title</kbd> | `string` | `"Damage Roll"` | Roll title |
| <kbd>options</kbd> | `Object` | `{}` | Flow options (see below) |
| <kbd>extraData</kbd> | `Object` | `{}` | Injected state data |

**`options` keys** (all merged onto the Lancer `DamageRollFlow` state):

| Key | Type | Default | Meaning |
|:----|:-----|:--------|:--------|
| <kbd>ap</kbd> | `boolean` | `false` | Armor Piercing. |
| <kbd>paracausal</kbd> | `boolean` | `false` | Damage can't be reduced (bypasses armor **and** resistances). |
| <kbd>overkill</kbd> | `boolean` | `false` | Overkill - the flow rerolls 1s on the damage dice (self-heat per reroll). |
| <kbd>reliable</kbd> | `boolean` | `false` | Reliable. |
| <kbd>half_damage</kbd> | `boolean` | `false` | Halve all damage dealt. |
| <kbd>add_burn</kbd> | `boolean` | `true` | Whether Burn-type damage also accumulates on the target's burn track. |
| <kbd>invade</kbd> | `boolean` | `false` | Flags the roll as an Invade tech-attack (passed to Lancer flow). |
| <kbd>has_normal_hit</kbd> | `boolean` | `true` | At least one normal (non-crit) hit exists -> rolls normal damage. |
| <kbd>has_crit_hit</kbd> | `boolean` | `false` | At least one crit exists -> rolls crit damage. |
| <kbd>tags</kbd> | `Array` | `[]` | Weapon tags that shape the roll (Overkill/Reliable/AP...). Element: `{ lid, val?, name?, description? }`. |
| <kbd>bonus_damage</kbd> | `Array` | `[]` | Extra damage entries added to the roll. Element: `{ type, val }` where `type` is a DamageType (`"Kinetic"`/`"Energy"`/`"Explosive"`/`"Heat"`/`"Burn"`/`"Variable"`) and `val` a formula string. |
| <kbd>hit_results</kbd> | `Array` | `[]` | Per-target hit outcomes that decide which targets take damage (chained damage rolls carry these instead of user targets). Element: `{ target: Token, total: string, hit: boolean, crit: boolean, usedLockOn?: boolean }`. |
| <kbd>targeting</kbd> | `Object` | - | See below. |

**`options.targeting`** `{ range?: number, pattern?: "target"|"blast"|"cone"|"line"|"burst", size?: number }` - opens the damage HUD with the targeting picker already engaged on that shape. Without it, the picker auto-engages only on weaponless rolls that start with no target.

```js
await api.executeDamageRoll(reactorToken, [target], 2, 'Heat', 'Ring of Fire');
```

</details>

## Checks & Saves

<details id="executeStatRoll">
<summary><b><code>executeStatRoll</code></b> <sup>async</sup> → <code>{completed, total, roll, passed}</code></summary>

<br>

```js
await api.executeStatRoll(actor, stat, title, target, extraData)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actor</kbd> | `Actor` | *required* | The actor making the roll |
| <kbd>stat</kbd> | `string` | *required* | `"HULL"`, `"AGI"`, `"SYS"`, `"ENG"`, `"GRIT"` |
| <kbd>title</kbd> | `string` | auto | Roll title |
| <kbd>target</kbd> | `number\|"token"\|Token\|TokenDocument` | `10` | Pass threshold or `"token"` for interactive choice |
| <kbd>extraData</kbd> | `Object` | `{}` | `{ targetStat: "HULL" }` to use a different stat for difficulty lookup |

`extraData.accuracy` / `extraData.difficulty` / `extraData.flatModifier` pre-fill the HASE HUD, the way a weapon's tags pre-fill an attack. They are added to whatever the HUD already computed and stay editable by the roller. No bonus needed for a one-off +1 Difficulty.

```js
await api.executeStatRoll(actor, 'SYS', 'Blind', witchToken, { difficulty: 1 });
```

</details>

<details id="executeSaveVsEffect">
<summary><b><code>executeSaveVsEffect</code></b> <sup>async</sup> → <code>Array&lt;{ target, passed, result }&gt;</code></summary>

<br>

```js
await api.executeSaveVsEffect(targets, options)
```

Save-or-effect over a target list: each target rolls the save (owner-routed by default, in parallel), failures get `effects` and/or `onFail`, passes get `onPass`.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>targets</kbd> | `Token\|Token[]` | *required* | Rollers |
| **inside `options`** | | | |
| <kbd>stat</kbd> | `string` | *required* | `"HULL"` / `"AGI"` / `"SYS"` / `"ENG"` / `"GRIT"` |
| <kbd>title</kbd> | `string` | *required* | Roll title |
| <kbd>origin</kbd> | `number\|Token` | `10` | Difficulty value or token to derive it from |
| <kbd>effects</kbd> | `string\|Object\|Array` | `null` | Applied on fail (`applyEffectsToTokens` shape) |
| <kbd>duration</kbd> / <kbd>note</kbd> / <kbd>extraFlags</kbd> | `Object` / `string` / `Object` | `null` | Forwarded to the effect application |
| <kbd>cardTitle</kbd> / <kbd>cardDescription</kbd> | `string \| ((target: Token) => string)` | `null` | Owner card text. Description can be per target |
| <kbd>sendToOwner</kbd> | `boolean` | `true` | Route each roll to its owner |
| <kbd>onFail</kbd> / <kbd>onPass</kbd> | `(target: Token, result: { passed: boolean, total: number }) => void \| Promise<void>` | `null` | Per-target extras |
| <kbd>accuracy</kbd> / <kbd>difficulty</kbd> / <kbd>flatModifier</kbd> | `number \| ((target: Token) => number)` | `0` | Pre-fill each roller's HASE HUD. Pass a function for a per-target value |
| <kbd>halfDamageOnSave</kbd> | `{ value, type?, title? }` | `null` | Afterwards roll this damage on ALL targets, halved for the ones that saved |

```js
await api.executeSaveVsEffect(targets, {
    stat: 'SYS', title: 'Blind', origin: witchToken, effects: ['blinded'],
    difficulty: (target) => api.inDangerZone(target) ? 1 : 0,
});
```

</details>

<details id="executeContestedCheck">
<summary><b><code>executeContestedCheck</code></b> <sup>async</sup> → <code>{ completed, winner, loser, winnerToken, loserToken, tie, results }</code></summary>

<br>

```js
const res = await api.executeContestedCheck(input1, stat1, input2, stat2, options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>input1</kbd> | `Actor\|Token` | *required* | First contender |
| <kbd>stat1</kbd> | `string` | *required* | `"HULL"` / `"AGI"` / `"SYS"` / `"ENG"` / `"GRIT"` |
| <kbd>input2</kbd> | `Actor\|Token` | *required* | Second contender |
| <kbd>stat2</kbd> | `string` | *required* | Second contender's stat |
| **inside `options`** | | | |
| <kbd>title</kbd> | `string` | `"Contested Check"` | Card header |
| <kbd>sendToOwner</kbd> | `boolean` | `true` | Roll on each contender's owner client |
| <kbd>accuracy1</kbd> / <kbd>accuracy2</kbd> | `number` | `0` | Accuracy dice pre-filled on that side's HASE HUD |
| <kbd>difficulty1</kbd> / <kbd>difficulty2</kbd> | `number` | `0` | Difficulty dice pre-filled on that side's HASE HUD |
| <kbd>flatModifier1</kbd> / <kbd>flatModifier2</kbd> | `number` | `0` | Flat modifier pre-filled on that side's HASE HUD |

Rolls both stats, posts an outcome card, plays the win/loss FX. `winner`/`loser` (and their `*Token`) are `null` on a tie. `results` always holds both `{ actor, stat, total, roll }`. This is what [`openHaseContestCard`](API_INTERACTIVE.md) returns.

```js
const res = await api.executeContestedCheck(tokenA, 'HULL', tokenB, 'AGI', { title: 'Grapple', difficulty2: 1 });
if (!res.tie && res.winnerToken === tokenA)
    ui.notifications.info(`${tokenA.name} wins the grapple`);
```

</details>

<details id="executeForceCheck">
<summary><b><code>executeForceCheck</code></b> <sup>async</sup> → <code>{ completed, results }</code></summary>

<br>

```js
const res = await api.executeForceCheck(skill, targets, options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>skill</kbd> | `string` | *required* | `"HULL"` / `"AGI"` / `"SYS"` / `"ENG"` |
| <kbd>targets</kbd> | `Token[]` | user targets | The tokens that roll |
| **inside `options`** | | | |
| <kbd>saveVs</kbd> | `Token\|Actor` | `null` | Makes it a save vs that actor's SAVE, pre-targeted in the roller's HUD |
| <kbd>sendToOwner</kbd> | `boolean` | `true` | Roll on each target's owner client |
| <kbd>title</kbd> | `string` | `""` | Card header |
| <kbd>accuracy</kbd> / <kbd>difficulty</kbd> / <kbd>flatModifier</kbd> | `number\|(rollerToken) => number` | `0` | Pre-filled on the roller's HASE HUD. Per-roller when given a function |

Sends each target its HASE check (owner rolls, or the GM if unowned). `saveVs` makes it a save vs that actor's SAVE, pre-targeted in the roller's HUD. Posts a PASS/FAIL summary. Returned by `openForceCheckCard`.

```js
await api.executeForceCheck('ENG', [target], { saveVs: witchToken, title: 'Petrify' });
```

</details>

## Activations & Actions

<details id="executeItemActivation">
<summary><b><code>executeItemActivation</code></b> <sup>async</sup> → <code>{completed, flow?}</code></summary>

<br>

```js
await api.executeItemActivation(item, options, extraData)
```

Runs an item's activation flow, using the same dispatch rules as `triggerData.startRelatedFlow`. The item's own automation fires. `activateGeneralAction` is the equivalent for registry actions that belong to no item.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>item</kbd> | `Item` | *required* | The item to activate |
| <kbd>extraData</kbd> | `Object` | `{}` | Merged onto `flow.state.la_extraData` before the flow begins |
| **inside `options`** | | | |
| <kbd>path</kbd> | `string` | `null` | Sets `action_path`, to pick one action on a multi-action item |
| <kbd>flowName</kbd> | `string` | `null` | Forces a specific flow class instead of the dispatched one |

```js
const { completed } = await api.executeItemActivation(item, {}, { fromReaction: true });
```

</details>

<details id="executeSimpleActivation">
<summary><b><code>executeSimpleActivation</code></b> <sup>async</sup> → <code>{completed, flow}</code></summary>

<br>

```js
await api.executeSimpleActivation(actor, options, extraData)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actor</kbd> | `Actor` | *required* | Acting actor |
| <kbd>options</kbd> | `{ title?: string; action?: { name, activation }; detail?: string; tags?: Array }` | `{}` | Card fields |
| <kbd>extraData</kbd> | `Object` | `{}` | Injected state data |

```js
await api.executeSimpleActivation(actor, {
    title: 'Vent Coolant',
    action: { name: 'Vent', activation: 'Quick' },
    detail: 'Clear 2 heat.'
});
```

</details>

<details id="activateGeneralAction">
<summary><b><code>activateGeneralAction</code></b> <sup>async</sup> → <code>{completed, flow}</code></summary>

<br>

```js
await api.activateGeneralAction(actorOrToken, name)
```

**Params:** <kbd>actorOrToken</kbd> `Actor|Token` · <kbd>name</kbd> `string` registry action name

Triggers a general action (Brace, Boost, ...) from its registry definition: activation type and card text come from the registry, and the action's automation fires. For an item's action use `executeItemActivation`.

```js
await api.activateGeneralAction(reactorToken, 'Brace');
```

</details>

<details id="executeExtraActionCombat">
<summary><b><code>executeExtraActionCombat</code></b> <sup>async</sup> → <code>{completed, flow}</code></summary>

<br>

```js
await api.executeExtraActionCombat(actorOrToken, action, sourceItem?)
```

Fires an extra action's combat mode: `action.laCombat === 'attack'` rolls a to-hit (tech attack when `activation` is `Invade`/`Quick Tech`/`Full Tech`, else a basic attack with a full acc_diff from its weapon `tags` + `accuracy`/`difficulty`/`attack_bonus`/`attack_type`). `'damage'` rolls `action.damage` with no to-hit. See the `ExtraAction` shape in [HUD API](API_HUD.md).

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actorOrToken</kbd> | `Actor\|Token` | *required* | The attacker |
| <kbd>action</kbd> | `ExtraAction` | *required* | The extra action (must have `laCombat`) |
| <kbd>sourceItem</kbd> | `Item\|null` | `null` | Owning item, if any (tech attacks route through it) |

```js
await api.executeExtraActionCombat(actor, {
    name: 'Turret Shot',
    activation: 'Quick',
    laCombat: 'attack',
    attack_bonus: 2,
    damage: [{ type: 'Kinetic', val: '1d3' }]
});
```

</details>

<details id="afterFx">
<summary><b><code>afterFx</code></b> → <code>void</code></summary>

<br>

```js
api.afterFx(callback)
```

Runs `callback` at flow end, right after lancer-weapon-fx starts its sequence (or immediately at flow end if there is no FX). Use in trigger code whose printed cards should land after the FX.

```js
api.afterFx(() => api.executeDamageRoll(reactorToken, targets, 4, 'Heat', 'Tear Down'));
```

</details>

## Meltdown & Rest

<details id="executeReactorMeltdown">
<summary><b><code>executeReactorMeltdown</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code><br><b><code>executeReactorExplosion</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code></summary>

<br>

```js
await api.executeReactorMeltdown(tokenOrActor, turns)
await api.executeReactorExplosion(token)
```

`executeReactorMeltdown` starts the meltdown countdown; `turns` skips the turn-picker dialog. `executeReactorExplosion` runs the explosion itself: a Burst 2 catch-confirm picker around the token, then the damage.

**Params:** <kbd>tokenOrActor</kbd> `Token|Actor` · <kbd>turns</kbd> `number` countdown length · <kbd>token</kbd> `Token` the exploding mech

```js
await api.executeReactorMeltdown(token, 2);
```

</details>

<details id="executeRest">
<summary><b><code>executeRest</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code><br><b><code>executeDowntime</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code><br><b><code>openAddReserveDialog</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code></summary>

<br>

```js
await api.executeRest(token)
await api.executeDowntime()
await api.openAddReserveDialog(tokenOrActor)
```

The out-of-combat flows, same as their TAH entries: the Rest card, the downtime activity builder, and the add-a-reserve dialog. Feature guide: [Gameplay Automation](feature/GAMEPLAY_AUTOMATION.md).

**Params:** <kbd>token</kbd> `Token` the resting mech · <kbd>tokenOrActor</kbd> `Token|Actor` the pilot's mech

```js
await api.executeRest(token);
```

</details>


---

## Weapon & Item Details

Processed weapon/item info, with active actor bonuses applied (e.g. Accuracy, Threat).

<details id="getItemTags_WithBonus">
<summary><b><code>getItemTags_WithBonus</code></b> <sup>async</sup> → <code>Array&lt;Object&gt;</code></summary>

<br>

```js
await api.getItemTags_WithBonus(item, actor)
```

Effective tag list for one item.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>item</kbd> | `Item` | *required* | The item to inspect |
| <kbd>actor</kbd> | `Actor` | `item.parent` | The actor whose bonuses should be applied |

```js
const tags = await api.getItemTags_WithBonus(weapon);
const isSmart = tags.some(t => t.lid === 'tg_smart');
```

</details>

<details id="getActorMaxThreat">
<summary><b><code>getActorMaxThreat</code></b> → <code>number</code></summary>

<br>

```js
api.getActorMaxThreat(actor)
```

Returns the highest Threat range across all weapons held by the actor, accounting for active bonuses.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>actor</kbd> | `Actor` | The actor to inspect |

```js
if (api.getTokenDistance(reactorToken, moverToken) <= api.getActorMaxThreat(reactorToken.actor))
    return true;
```

</details>

<details id="getMaxWeaponRanges_WithBonus">
<summary><b><code>getMaxWeaponRanges_WithBonus</code></b> → <code>Record&lt;string, number&gt;</code></summary>

<br>

```js
api.getMaxWeaponRanges_WithBonus(input)
```

Returns the maximum range value per range type across all weapons provided in the input.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>input</kbd> | `Actor\|Token\|Item\|Array` | The source(s) to scan for weapons |

```js
const ranges = api.getMaxWeaponRanges_WithBonus(actor);
const threat = ranges.Threat ?? 1;
```

</details>

<details id="getMaxWeaponReach_WithBonus">
<summary><b><code>getMaxWeaponReach_WithBonus</code></b> <sup>async</sup> → <code>number</code></summary>

<br>

```js
await api.getMaxWeaponReach_WithBonus(input)
```

Returns the single highest reach value across all scanned weapons. Scans `Range`, `Threat`, `Line`, `Burst`, and `Cone` (ignores `Blast`). Also accounts for the `tg_thrown` tag.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>input</kbd> | `Actor\|Token\|Item\|Array` | The source(s) to scan for weapons |

```js
const reach = await api.getMaxWeaponReach_WithBonus(reactorToken);
```

</details>

<details id="getMaxItemRanges_WithBonus">
<summary><b><code>getMaxItemRanges_WithBonus</code></b> <sup>async</sup> → <code>Object</code></summary>

<br>

```js
await api.getMaxItemRanges_WithBonus(item, actor)   // { Range: 10, Thrown: 5, Deploy: 8 }
```

Single item's max range per type, with bonuses. Also folds in action ranges, `tg_thrown` (`Thrown`) and `deployRange` (`Deploy`).

**Params:** <kbd>item</kbd> `Item` · <kbd>actor</kbd> `Actor` (optional, defaults to `item.parent`).

```js
const ranges = await api.getMaxItemRanges_WithBonus(item);
const throwRange = ranges.Thrown ?? 0;
```

</details>

<details id="getWeaponProfiles_WithBonus">
<summary><b><code>getWeaponProfiles_WithBonus</code></b> → <code>Array&lt;Object&gt;</code></summary>

<br>

```js
api.getWeaponProfiles_WithBonus(weapon, actor)[weapon.system.selected_profile_index ?? 0].range
```

All profiles with bonuses merged into `range`/`damage` (`base_range`/`base_damage` keep the originals).

**Params:** <kbd>weapon</kbd> `Item` · <kbd>actor</kbd> `Actor` (optional, defaults to `weapon.parent`).

```js
const profile = api.getWeaponProfiles_WithBonus(weapon)[weapon.system.selected_profile_index ?? 0];
```

</details>

<details id="getSensorRange_WithBonus">
<summary><b><code>getSensorRange_WithBonus</code></b> → <code>number</code></summary>

<br>

```js
api.getSensorRange_WithBonus(actor)
```

Actor's effective sensor range (`system.sensor_range`, else `10`), plus any `Sensor` range-type bonuses.

**Params:** <kbd>input</kbd> `Actor|Token`.

```js
const inSensors = api.getTokenDistance(reactorToken, target) <= api.getSensorRange_WithBonus(reactorToken);
```

</details>

<details id="hasTag">
<summary><b><code>hasTag</code></b> <sup>async</sup> → <code>boolean</code></summary>

<br>

```js
await api.hasTag(item, 'smart')   // or 'tg_smart'
```

**Params:** <kbd>item</kbd> `Item` · <kbd>lid</kbd> `string` tag LID

True if the item has the tag (bonus-aware). Accepts the LID with or without `tg_`.

```js
if (!await api.hasTag(weapon, 'smart')) return false;
```

</details>

---

#### Simple lookups

| Function | Returns | Description |
|:---------|:--------|:------------|
| `getWeaponType(item)` | `string` | Weapon subtype (e.g. `"Superheavy Rifle"`, `"Melee"`). Synchronous, no bonuses. |
| `getItemType(item)` | `string` | Lancer item type (e.g. `"Weapon"`, `"System"`, `"mech_weapon"`). |
| `getActivationIcon(actionOrActivation)` | `string` | Icon path or CSS class. Accepts `"reaction"`, `"quick"`, `"full"`, `"protocol"`, `"free"` or an action object. |
