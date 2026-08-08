# API - Combat & Weapons

[Back to API Reference](API_REFERENCE.md) · Feature guide: [Gameplay Automation](feature/GAMEPLAY_AUTOMATION.md)

---

## Combat & Execution Flows

<details>
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

</details>

---

<details>
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
| <kbd>options</kbd> | `Object` | `{}` | `{ title?: string, sendToOwner?: boolean }` |

Rolls both stats, posts an outcome card, plays the win/loss FX. `winner`/`loser` (and their `*Token`) are `null` on a tie; `results` always holds both `{ actor, stat, total, roll }`. This is what [`openHaseContestCard`](API_INTERACTIVE.md) returns.

</details>

---

<details>
<summary><b><code>executeForceCheck</code></b> <sup>async</sup> → <code>{ completed, results }</code></summary>

<br>

```js
const res = await api.executeForceCheck(skill, targets, options)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>skill</kbd> | `string` | *required* | `"HULL"` / `"AGI"` / `"SYS"` / `"ENG"` |
| <kbd>targets</kbd> | `Token[]` | user targets | The tokens that roll |
| <kbd>options</kbd> | `Object` | `{}` | `{ saveVs?: Token\|Actor, sendToOwner?: boolean = true, title?: string }` |

Sends each target its HASE check (owner rolls; GM if unowned). `saveVs` makes it a save vs that actor's SAVE, pre-targeted in the roller's HUD. Posts a PASS/FAIL summary; returned by `openForceCheckCard`.

</details>

---

<details>
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
| <kbd>ap</kbd> | `boolean` | `false` | Armor Piercing - damage ignores the target's armor. |
| <kbd>paracausal</kbd> | `boolean` | `false` | Damage can't be reduced (bypasses armor **and** resistances). |
| <kbd>overkill</kbd> | `boolean` | `false` | Overkill - the flow rerolls 1s on the damage dice (self-heat per reroll). |
| <kbd>reliable</kbd> | `boolean` | `false` | Reliable - applies a minimum-damage floor. |
| <kbd>half_damage</kbd> | `boolean` | `false` | Halve all damage dealt. |
| <kbd>add_burn</kbd> | `boolean` | `true` | Whether Burn-type damage also accumulates on the target's burn track. `false` = immediate burn hit only, no ongoing burn. |
| <kbd>invade</kbd> | `boolean` | `false` | Flags the roll as an Invade tech-attack (passed to Lancer flow). |
| <kbd>has_normal_hit</kbd> | `boolean` | `true` | At least one normal (non-crit) hit exists -> rolls normal damage. |
| <kbd>has_crit_hit</kbd> | `boolean` | `false` | At least one crit exists -> rolls crit damage. |
| <kbd>tags</kbd> | `Array` | `[]` | Weapon tags that shape the roll (Overkill/Reliable/AP...). Element: `{ lid, val?, name?, description? }`. |
| <kbd>bonus_damage</kbd> | `Array` | `[]` | Extra damage entries added to the roll. Element: `{ type, val }` where `type` is a DamageType (`"Kinetic"`/`"Energy"`/`"Explosive"`/`"Heat"`/`"Burn"`/`"Variable"`) and `val` a formula string. |
| <kbd>hit_results</kbd> | `Array` | `[]` | Per-target hit outcomes that decide which targets take damage (chained damage rolls carry these instead of user targets). Element: `{ target: Token, total: string, hit: boolean, crit: boolean, usedLockOn?: boolean }`. |
| <kbd>targeting</kbd> | `Object` | - | See below. |

**`options.targeting`** `{ range?: number, pattern?: "target"|"blast"|"cone"|"line"|"burst", size?: number }` - opens the damage HUD with the targeting picker already engaged on that shape. Without it, the picker auto-engages only on weaponless rolls that start with no target.

</details>

---

<details>
<summary><b><code>executeBasicAttack</code></b> <sup>async</sup> → <code>{completed, flow}</code></summary>

<br>

```js
await api.executeBasicAttack(actor, options, extraData)
```

Starts a `BasicAttackFlow`. The `options` object is passed directly to the flow constructor.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actor</kbd> | `Actor` | *required* | The actor making the attack |
| <kbd>options</kbd> | `Object` | `{}` | Flow constructor options |
| <kbd>extraData</kbd> | `Object` | `{}` | Injected into `state.la_extraData` |

</details>

---

<details>
<summary><b><code>executeTechAttack</code></b> <sup>async</sup> → <code>{completed, flow}</code></summary>

<br>

```js
await api.executeTechAttack(target, options, extraData)
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>target</kbd> | `Actor\|Item` | *required* | The actor or item initiating the tech attack |
| <kbd>options</kbd> | `Object` | `{}` | Flow options |
| <kbd>extraData</kbd> | `Object` | `{}` | Injected state data |

</details>

---

<details>
<summary><b><code>executeExtraActionCombat</code></b> <sup>async</sup> → <code>{completed, flow}</code></summary>

<br>

```js
await api.executeExtraActionCombat(actorOrToken, action, sourceItem?)
```

Fires an extra action's combat mode: `action.laCombat === 'attack'` rolls a to-hit (tech attack when `activation` is `Invade`/`Quick Tech`/`Full Tech`, else a basic attack with a full acc_diff from its weapon `tags` + `accuracy`/`difficulty`/`attack_bonus`/`attack_type`); `'damage'` rolls `action.damage` with no to-hit. See the `ExtraAction` shape in [API_HUD.md](API_HUD.md).

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actorOrToken</kbd> | `Actor\|Token` | *required* | The attacker |
| <kbd>action</kbd> | `ExtraAction` | *required* | The extra action (must have `laCombat`) |
| <kbd>sourceItem</kbd> | `Item\|null` | `null` | Owning item, if any (tech attacks route through it) |

</details>

---

<details>
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

</details>

---

<details>
<summary><b><code>executeSkirmish</code></b> <sup>async</sup> → <code>void</code></summary>

<br>

```js
await api.executeSkirmish(actorOrToken, bypassMount, preTarget, weaponFilter)
```

Optionally bypasses mount selection or pre-targets a token.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>actorOrToken</kbd> | `Actor\|Token\|TokenDocument` | *required* | The actor or token performing the skirmish |
| <kbd>bypassMount</kbd> | `Object` | `null` | Mount object to skip mount selection |
| <kbd>preTarget</kbd> | `Token` | `null` | Pre-selected target token |
| <kbd>weaponFilter</kbd> | `Function` | `null` | `(weapon) => boolean` filter for available weapons |

</details>

---

<details>
<summary><b><code>beginWeaponAttackFlow</code></b> <sup>async</sup> → <code>{completed, flow?}</code></summary>

<br>

```js
await api.beginWeaponAttackFlow(weapon, options, extraData)
```

Starts a weapon attack flow for a specific weapon item (e.g. an NPC's specific rifle).

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>weapon</kbd> | `Item` | *required* | The weapon item to attack with |
| <kbd>options</kbd> | `Object` | `{}` | Flow options |
| <kbd>extraData</kbd> | `Object` | `{}` | Injected state data |

</details>

---

## Weapon & Item Details

Processed weapon/item info, with active actor bonuses applied (e.g. Accuracy, Threat).

<details>
<summary><b><code>getItemTags_WithBonus</code></b> <sup>async</sup> → <code>Array&lt;Object&gt;</code></summary>

<br>

```js
await api.getItemTags_WithBonus(item, actor)
```

Returns the effective tag list for a single item, with actor bonuses applied.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>item</kbd> | `Item` | *required* | The item to inspect |
| <kbd>actor</kbd> | `Actor` | `item.parent` | The actor whose bonuses should be applied |

</details>

---

<details>
<summary><b><code>getActorMaxThreat</code></b> <sup>async</sup> → <code>number</code></summary>

<br>

```js
await api.getActorMaxThreat(actor)
```

Returns the highest Threat range across all weapons held by the actor, accounting for active bonuses.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>actor</kbd> | `Actor` | The actor to inspect |

</details>

---

<details>
<summary><b><code>getMaxWeaponRanges_WithBonus</code></b> <sup>async</sup> → <code>Object</code></summary>

<br>

```js
await api.getMaxWeaponRanges_WithBonus(input)
// e.g. returns { Range: 25, Burst: 3 }
```

Returns the maximum range value per range type across all weapons provided in the input.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>input</kbd> | `Actor\|Token\|Item\|Array` | The source(s) to scan for weapons |

</details>

---

<details>
<summary><b><code>getMaxWeaponReach_WithBonus</code></b> <sup>async</sup> → <code>number</code></summary>

<br>

```js
await api.getMaxWeaponReach_WithBonus(input)
```

Returns the single highest reach value across all scanned weapons. Scans `Range`, `Threat`, `Line`, `Burst`, and `Cone` (ignores `Blast`). Also accounts for the `tg_thrown` tag.

| Param | Type | Description |
|:------|:-----|:------------|
| <kbd>input</kbd> | `Actor\|Token\|Item\|Array` | The source(s) to scan for weapons |

</details>

---

<details>
<summary><b><code>getMaxItemRanges_WithBonus</code></b> <sup>async</sup> → <code>Object</code></summary>

<br>

```js
await api.getMaxItemRanges_WithBonus(item, actor)   // { Range: 10, Thrown: 5, Deploy: 8 }
```

Single item's max range per type, with bonuses. Also folds in action ranges, `tg_thrown` (`Thrown`) and `deployRange` (`Deploy`).

**Params:** <kbd>item</kbd> `Item` · <kbd>actor</kbd> `Actor` (optional, defaults to `item.parent`).

</details>

---

<details>
<summary><b><code>getWeaponProfiles_WithBonus</code></b> → <code>Array&lt;Object&gt;</code></summary>

<br>

```js
api.getWeaponProfiles_WithBonus(weapon, actor)[weapon.system.selected_profile_index ?? 0].range
```

All profiles with bonuses merged into `range`/`damage` (`base_range`/`base_damage` keep the originals).

**Params:** <kbd>weapon</kbd> `Item` · <kbd>actor</kbd> `Actor` (optional, defaults to `weapon.parent`).

</details>

---

<details>
<summary><b><code>getSensorRange_WithBonus</code></b> → <code>number</code></summary>

<br>

```js
api.getSensorRange_WithBonus(actor)
```

Actor's effective sensor range (`system.sensor_range`, else `10`), plus any `Sensor` range-type bonuses.

**Params:** <kbd>actor</kbd> `Actor|Token`.

</details>

---

<details>
<summary><b><code>hasTag</code></b> <sup>async</sup> → <code>boolean</code></summary>

<br>

```js
await api.hasTag(item, 'smart')   // or 'tg_smart'
```

True if the item has the tag (bonus-aware). Accepts the LID with or without `tg_`.

</details>

---

#### Simple lookups

| Function | Returns | Description |
|:---------|:--------|:------------|
| `getWeaponType(item)` | `string` | Weapon subtype (e.g. `"Superheavy Rifle"`, `"Melee"`). Synchronous, no bonuses. |
| `getItemType(item)` | `string` | Lancer item type (e.g. `"Weapon"`, `"System"`, `"mech_weapon"`). |
| `getActivationIcon(actionOrActivation)` | `string` | Icon path or CSS class. Accepts `"reaction"`, `"quick"`, `"full"`, `"protocol"`, `"free"` or an action object. |
