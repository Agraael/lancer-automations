# Effect Manager & Bonuses

[← Back to the README](../../README.md) · API: [API_EFFECTS.md](../API_EFFECTS.md)

The Effect Manager applies status effects and bonuses to a token. Drive it by hand from the token HUD, or from automation code. Effects can carry a duration and consumable charges; bonuses apply to Lancer's roll flows.

---

## The Effect Manager dialog

You can open it two ways: the **Effect Manager** button in the Token Action HUD, or a button on the token HUD (toggled by the `showBonusHudButton` setting).

| From the Token Action HUD | From the token HUD |
|:---:|:---:|
| ![Effect Manager in the TAH](../img/em-open-tah.png) | ![Effect Manager on the token HUD](../img/em-open-hud.png) |

Its tabs:

- **Standard** - apply built-in Lancer and Foundry status effects.
- **Custom** - make your own named effects (only with Temporary Custom Statuses).
- **Bonus** - build accuracy, damage, stat, and other bonuses.
- **Manage** - see and edit what's already on the token.

Everything here can also be driven from automation code; signatures are in [API_EFFECTS.md](../API_EFFECTS.md).

## Standard tab

<img align="right" src="../img/em-standard.png" width="55%"/>

Pick a status from the searchable grid and apply it with:

- a **duration** - end of turn, start of turn, indefinite, or permanent (survives a Full Repair) - plus an **origin token** for turn tracking (turn-based durations only count down while combat is running),
- a **stack count**,
- an optional **note** (e.g. "granted by X"),
- optional **consumption** (see below).

Hover a status for its description. Save common setups as **presets** from the bar above the tab.

<br clear="right"/>

## Custom tab

<img align="right" src="../img/em-custom.png" width="55%"/>

This tab only appears when the **Temporary Custom Statuses** module is active; it's the front-end for that module's custom statuses. Make an effect with any name, icon, stack count, duration, and active-effect changes (a JSON array of stat changes). A **Save** button stores a custom status (name and icon) to a Saved dropdown you can reload in later sessions, and saved statuses also show up in the Standard tab's grid.

<br clear="right"/>

## Consuming effects

A stacked effect can burn a charge on its own when something happens. Pick one or more **consumption triggers** (on attack, hit, damage, move, turn start, status applied, and more); the stack drops by one each time, and the effect clears itself at zero.

Most triggers offer **filters** so the charge only burns in the right situation (the available filters change with the trigger):

- by **item** - a weapon's LID, or a specific weapon instance on the token (item ID, via an inventory picker),
- by **action name** or **check type** (HULL / AGI / SYS / ENG),
- by **status** (a grid picker),
- **boost only**, for move triggers.

For anything the filters can't express, write a short **evaluate function** that decides whether a given event should consume a charge. It receives the trigger type, the trigger data, the effect's token, and the effect object.

## Bonuses

<img align="right" src="../img/em-bonus-tab.png" width="55%"/>

Bonuses apply mechanical changes to Lancer's roll flows. They persist in one of three ways:

- **General** - visible on the token. Give it a duration (end of turn, start of turn, or indefinite) and it shows an icon like a status, with optional charges.
- **Constant** - invisible and permanent. In the dialog this is the **None (Permanent, no Icon)** duration; from code it's `addConstantBonus`, for baseline stats or immunities (see [AUTOMATION_ENGINE.md](./AUTOMATION_ENGINE.md) and the Insulated example in [NPC_EXAMPLES.md](./NPC_EXAMPLES.md)). It survives a reload.
- **Flow** - injected into the current flow only, via `triggerData.flowState.injectBonus(...)` from a reaction.

Full API (every type, immunity queries, flow injection) is in [API_EFFECTS.md](../API_EFFECTS.md).

<br clear="right"/>

### Bonus types

<img align="right" src="../img/em-bonus-roll.png" width="53%"/>

| Type | What it does |
|------|--------------|
| **Accuracy / Difficulty** | Add accuracy or difficulty dice to matching rolls (attacks, checks, saves). |
| **Damage** | Add extra damage of any type (e.g. +2d6 Kinetic), per-target or global. |
| **Stat** | Change an actor stat: HP, Heat, Armor, Speed, Evasion, and so on. |
| **Tag** | Add, increment, override, or remove a weapon tag (Accurate, Overkill, ...). |
| **Range** | Change a weapon's ranges (Range, Threat, Blast, Burst, Cone, Line). |
| **Immunity** | Immunity to a damage type, effect, crit, terrain, or engagement. Prompts a choice card on incoming damage (below). |
| **Target Modifier** | Tactical changes to the target: cover, invisibility, armor-piercing, half-damage, paracausal, or force a hit / crit / miss. |
| **Reroll** | Reroll a roll type (attack, tech attack, damage, skill, structure, stress). Modes: retry, highest, lowest, or choose. |

Accuracy and difficulty bonuses show up in the roll HUD before you confirm; damage bonuses appear in the damage output.

<br clear="right"/>

### Tuning a bonus

- **Roll-type filters** - restrict to attacks (melee / ranged / tech), checks (HULL / AGI / SYS / ENG / grit), structure, overheat, or all flows.
- **Item / token filters** - scope to a weapon by **LID** (a type), or to a specific weapon instance on the token (**item ID**, via an inventory picker), and to one or more **target tokens**.
- **Apply to targetter** - reverse it: the target applies the bonus to the attacker, for debuffs or reactive effects.
- **Uses** - a charge count; the bonus is removed when it hits zero.
- **Condition / Apply-to-condition functions** - short synchronous JS gates: whether the bonus applies at all, or whether it applies to one specific target.
- **Consumption** - the same trigger system as effects above, to deplete charges on events.

## Immunity and the choice card

<img align="right" src="../img/em-immunity-card.png" width="53%"/>

When a token holds an immunity bonus and takes matching damage, a **choice card** prompts whether to apply the immunity.

<br clear="right"/>

## Manage tab

<img align="right" src="../img/em-manage.png" width="55%"/>

See every effect and bonus on the selected token, nudge stacks with the +/- buttons, or delete them outright. Bonuses show their full summary - type and effect (e.g. "Damage [2d6 Kinetic]"), remaining uses, item filters, and which flows they apply to - Constant ones included. Duplicate module effects that share a name collapse into one icon with a count badge.

<br clear="right"/>

> The Infection damage type is built on this system but has its own guide: [INFECTION.md](./INFECTION.md).
