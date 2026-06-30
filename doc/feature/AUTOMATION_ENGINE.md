# Automation Engine

[← Back to the README](../../README.md) · Engine internals: [AUTOMATION_SYSTEM.md](../AUTOMATION_SYSTEM.md) · API: [API_REFERENCE.md](../API_REFERENCE.md)

The automation engine lets you automate almost anything in Lancer.

Engine internals (full trigger list, evaluate / activation / onInit callbacks, cancel and modify, client and socket execution) are in **[AUTOMATION_SYSTEM.md](../AUTOMATION_SYSTEM.md)**.

## What's automated out of the box

Lancer Automations provides basic automation for most of the game's base actions. But as of now there's no official, ready-made automation for specific NPC or mech items (yet). For those, it's up to you to build your own, and the Activation Manager is where you do it.

## The Activation Manager

<img align="right" src="../img/ae-activation-manager.png" width="35%"/>

Register, modify, and copy automations. Open it from the Lancer Automations settings.

It has two kinds of entries:

- **Item-based** automations are tied to a Lancer item by its LID. Only tokens that own that item can react. You can also bind one to a deployable LID, or to a specific Actor UUID, so it reacts only as that one exact actor instead of every actor with the item.
- **General** automations aren't tied to any item. Any token in the scene can react, filtered by the rules you set.

Entries can be sorted into named **folders**, and there's a **Startup Scripts** tab, covered further down.

Each activation has an **enable / disable** toggle. It works per sub-reaction on a multi-reaction item, and on the built-in and personal-set automations too (the toggle is saved as your own override, so disabling a built-in one sticks).

<br clear="right"/>

### Finding an item's LID

<img align="right" src="../img/ae-lid-finder.png" width="45%"/>

Item-based automations need the item's LID. The **LID finder** on the Item tab browses your world and compendium items so you can search and copy a LID, and see the action paths inside it. A deployable can be set to react to its own deploy (the `onDeploy` trigger); covered in [AUTOMATION_SYSTEM.md](../AUTOMATION_SYSTEM.md).

<br clear="right"/>

## Configuring an activation

![Reaction config form](../img/ae-reaction-config.png)

Each activation is a small form. The main fields:

| Group | What you set |
|-------|--------------|
| **Triggers** | Which game events fire it (`onMove`, `onHit`, `onActivation`, `onDeploy`, and many more). Full list in [AUTOMATION_SYSTEM.md](../AUTOMATION_SYSTEM.md). |
| **Mode** | How it composes with the original action: **instead of** or **after** it, and whether it **auto-activates** silently (no popup). |
| **Filters** | Disposition (Friendly / Hostile / Neutral, plus Token Factions teams), trigger-self / trigger-other, only-on-source-match, require-can-provoke, and out-of-combat. |
| **Binding** | What the automation attaches to: an item LID, a deployable LID, or an Actor UUID, plus an action path to bind one sub-action, the action type shown in the popup (Reaction / Quick / Full / ...), and frequency. |
| **Text** | Override the trigger and effect descriptions shown in the popup. |

## How an activation runs

<img src="../img/ae-example.png" width="45%"/>

When a trigger fires and the filters pass, three pieces decide the outcome.

**Activation type** sets *what* runs: your own **code**, the item's normal **flow**, a **macro**, or **none**.

**The evaluate function** runs first, as a final check. Return `true` to go ahead, `false` to skip. Use it for conditions the filters can't express, like "only if the target is below half HP" or "only if the attacker is flying".

**The activation code** is the effect itself, run when the automation fires. It has access to the full `api` (apply effects, move tokens, place zones, show choice cards, etc.).

There's also an **onInit** block that runs once when a token is created, for passive setup like constant bonuses or auras.

You write these as plain function bodies, or full functions (the wrapper is stripped for you). The exact arguments each block receives, the order filters run in, and the synchronous rule for cancel and modify triggers are in [AUTOMATION_SYSTEM.md](../AUTOMATION_SYSTEM.md).

By default `onActivation` fires when an item runs through an activation; **`treatGenericPrintAsActivation`** also fires it for items printed via Lancer's generic print.

## The activation popup

<img align="right" src="../img/ae-activation-popup.png" width="45%"/>

When a trigger fires reactions that aren't set to auto-activate, they're collected into a popup, grouped by token. Click an entry to expand its detail panel (trigger text, effect, action type badge, frequency), then click **Activate** to run it.

- Who sees the popup depends on the **`reactionNotificationMode`** setting: the token's owner, the GM, or both.
- **Right-click** a reaction to open its source item's sheet.
- If more reactions trigger while a popup is open, a small **pending badge** shows how many are queued behind it.

<br clear="right"/>

## Reaction economy

If **`consumeReaction`** is on, activating a reaction spends that token's reaction for the round. The popup shows the reaction as unavailable once it's spent. This is optional.

## Startup scripts

<img align="right" src="../img/ae-startup-scripts.png" width="45%"/>

The **Startup Scripts** tab in the Activation Manager holds code that runs once when Foundry is ready, before play starts. The main use is registering helper functions with `api.registerUserHelper`, callable from any activation or macro.

The registration patterns are in [API_HOWTO.md](../API_HOWTO.md).

<br clear="right"/>

## The personal activation set

Module Settings has a toggle for my personal activation set (**`enableLaSossisItems`**): 30+ of my own item automations, with examples like Dispersal Shield, Marker Rifle, and Defense Net.

> [!NOTE]
> This is **my own stuff, not part of the core module**. It's literally the automations I built for my own games (my NPCs, my items), shared as-is. It isn't a complete or general library, and it won't automate your content. Treat it as a set of examples to learn from, not something to rely on.

The worked examples are walked through in [NPC_EXAMPLES.md](./NPC_EXAMPLES.md), and the patterns for registering your own automations from code are in [API_HOWTO.md](../API_HOWTO.md).

<img src="../img/ae-personal-set.png" width="45%"/>
