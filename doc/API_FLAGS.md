# API - Flags & Gates

[Back to API Reference](API_REFERENCE.md)

---

## Item, Token & Actor Flags

<details id="addItemFlags">
<summary><b><code>addItemFlags</code></b> <sup>async</sup> → <code>Item</code><br><b><code>removeItemFlags</code></b> <sup>async</sup> → <code>Item</code><br><b><code>getItemFlags</code></b> → <code>any</code></summary>

<br>

```js
await api.addItemFlags(item, flags)            // set flags under 'lancer-automations'
await api.removeItemFlags(item, flags)         // unset the listed keys
api.getItemFlags(item, flagName?)              // read flags (specific key or all)
```

**Params:** <kbd>item</kbd> `Item` · <kbd>flags</kbd> `Object` key/value pairs · <kbd>flagName</kbd> `string` optional single key

Routes through the GM via socket when the calling user does not own the item. Every add / remove helper on this page returns `null` and posts a `ui.notifications.error` when the document is missing or `flags` is not an object.

**Known flag keys** (the subset meant for you to write, the namespace also holds keys the module manages on its own):

| Key | Type | Used by | Description |
|:----|:-----|:--------|:------------|
| <kbd>deployRange</kbd> | `number` | `placeDeployable` | Default placement range |
| <kbd>deployCount</kbd> | `number` | `placeDeployable` | Default number to place |

**Example:**
```js
await api.addItemFlags(myItem, { deployRange: 5, deployCount: 2 });
```

</details>

<details id="addTokenFlags">
<summary><b><code>addTokenFlags</code></b> <sup>async</sup> → <code>TokenDocument</code><br><b><code>removeTokenFlags</code></b> <sup>async</sup> → <code>TokenDocument</code><br><b><code>getTokenFlags</code></b> → <code>any</code></summary>

<br>

```js
await api.addTokenFlags(tokenOrDoc, flags)     // set flags under 'lancer-automations'
await api.removeTokenFlags(tokenOrDoc, flags)  // unset the listed keys
api.getTokenFlags(tokenOrDoc, flagName?)       // read flags (specific key or all)
```

The token-document counterpart to `addItemFlags` / `removeItemFlags` / `getItemFlags`. Routes through the GM via socket when the calling user does not own the token.

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>tokenOrDoc</kbd> | `Token\|TokenDocument` | *required* | Token to read or stamp |
| <kbd>flags</kbd> | `Object` | *required* | Key/value pairs set under `lancer-automations`. For `removeTokenFlags` only the keys matter |
| <kbd>flagName</kbd> | `string` | `null` | Read one key. Omit for the whole namespace object |

```js
await api.addTokenFlags(token, { wasArmed: true });
const armed = api.getTokenFlags(token, 'wasArmed');
await api.removeTokenFlags(token, { wasArmed: true });
```

`wasArmed` is the module-managed flag the `Mine Zone` arming reaction stamps to keep a mine from re-arming. Your own keys go in the same namespace.

</details>

<details id="addActorFlags">
<summary><b><code>addActorFlags</code></b> <sup>async</sup> → <code>Actor</code><br><b><code>removeActorFlags</code></b> <sup>async</sup> → <code>Actor</code><br><b><code>getActorFlags</code></b> → <code>any</code></summary>

<br>

```js
await api.addActorFlags(actor, flags)          // set flags under 'lancer-automations'
await api.removeActorFlags(actor, flags)       // unset the listed keys
api.getActorFlags(actor, flagName?)            // read flags (specific key or all)
```

**Params:** <kbd>actor</kbd> `Actor` · <kbd>flags</kbd> `Object` key/value pairs · <kbd>flagName</kbd> `string` optional single key

Routes through the GM via socket when the calling user does not own the actor.

**Known flag keys** (deployable Mines, read by the `Mine Zone` general reaction). Same caveat as above: this is the writable subset, not the whole namespace.

| Key | Type | Default | Description |
|:----|:-----|:--------|:------------|
| <kbd>mineDetectionRadius</kbd> | `number` | `1` | Aura radius in grid units. |
| <kbd>mineDetectionDisposition</kbd> | `"ALL"` \| `"FRIENDLY"` \| `"HOSTILE"` \| `"NEUTRAL"` | `"ALL"` | Which disposition triggers the detonation prompt. |
| <kbd>customMineDetection</kbd> | `boolean` | `false` | Skip the default `LA_MineZone` aura entirely. The per-LID handler installs its own detection. |

**Example:**
```js
await api.addActorFlags(mineActor, {
    mineDetectionRadius: 3,
    mineDetectionDisposition: "HOSTILE"
});
```

</details>

---

## Gates

<details id="consumeGate">
<summary><b><code>consumeGate</code></b> <sup>async</sup> → <code>Promise&lt;boolean&gt;</code><br><b><code>checkGate</code></b> → <code>boolean</code><br><b><code>clearGate</code></b> <sup>async</sup> → <code>Promise&lt;void&gt;</code><br><b><code>consumeOncePerRound</code></b> <sup>async</sup> → <code>Promise&lt;boolean&gt;</code><br><b><code>consumeOncePerTurn</code></b> <sup>async</sup> → <code>Promise&lt;boolean&gt;</code></summary>

<br>

```js
await api.consumeGate(owner, key, { subject?, rounds?, turn? })  // take the gate → true when it was free
api.checkGate(owner, key, subject?)                              // peek without taking
await api.clearGate(owner, key, subject?)                        // release early (omit subject: whole key)
await api.consumeOncePerRound(owner, key, subject?)              // consumeGate with rounds: 1
await api.consumeOncePerTurn(owner, key, subject?)               // consumeGate with turn: true
```

| Param | Type | Default | Description |
|:------|:-----|:--------|:------------|
| <kbd>owner</kbd> | `Token \| Actor` | *required* | Holds the gate, usually the reactor |
| <kbd>key</kbd> | `string` | *required* | Name of the gate, e.g. `'ring_of_fire'` |
| <kbd>subject</kbd> | `Token \| Actor \| string \| null` | `null` | Counted separately per subject. Omit for one gate on the owner |
| **inside `consumeGate`'s options** | | | |
| <kbd>rounds</kbd> | `number \| null` | `1` | Rounds blocked counting the current one. `null` lasts the whole combat |
| <kbd>turn</kbd> | `boolean` | `false` | Block for the current turn instead of a round count |

`subject` is the third positional argument on `checkGate`, `clearGate`, `consumeOncePerRound` and `consumeOncePerTurn`. On `consumeGate` it is a key of the options object instead.

Rate limits stored as one actor flag. Expiry is checked on read, nothing ticks, and a gate only lives inside the combat it was taken in. Out of combat every call succeeds. `checkGate` is sync, safe in `evaluate`.

`rounds` stores an absolute expiry round, `combat.round + max(1, rounds) - 1`, and the gate is blocked while the current round is at or below it. Taken with `rounds: 2` on round 5, it expires at the start of round 7.

An owner that resolves to no actor, or a falsy `key`, makes the whole family inert: `consumeGate` and `checkGate` return `true` (fail open, the gate never blocks) and `clearGate` does nothing.

```js
if (await api.consumeOncePerRound(reactorToken, 'ring_of_fire', target))
    await api.executeDamageRoll(reactorToken, [target], 2, 'Heat', 'Ring of Fire');

if (!await api.consumeGate(reactorToken, 'flicker_field', { subject: 'standard', rounds: 2 }))
    return;
```

</details>

---

## Flow Flags

<details id="getFlowFlag">
<summary><b><code>getFlowFlag</code></b> → <code>any</code><br><b><code>setFlowFlag</code></b> → <code>boolean</code></summary>

<br>

```js
api.getFlowFlag(triggerData, key)         // read a la_extraData flag off the flow
api.setFlowFlag(triggerData, key, value?) // stamp it (once-per-flow gates)
```

**Params:** <kbd>triggerData</kbd> the trigger's data object · <kbd>key</kbd> `string` · <kbd>value</kbd> `any` (default `true`)

They replace the hand-written `flowState.la_extraData` stamp and its evaluate read.

</details>
