# System Additions

[← Back to the README](../../README.md)

A few changes Lancer Automations makes to the Lancer system and its sheets.

---

## Item Disabled

<img align="right" src="../img/sa-item-disabled.png" width="30%"/>

Right-click a mech weapon, mech system, NPC feature, or weapon mod on its sheet to **disable** it. A disabled item dims with a power-off icon and is blocked from every attack and activation flow; a Full Repair clears the flag. The throw-weapon automation uses it to disable a weapon while it's out on the field.

<br clear="right"/>

## Ammo

<img align="right" src="../img/sa-ammo.png" width="30%"/>

Mech systems can carry **ammo**. Each entry shows on the system's sheet with its name, description, and cost; clicking **USE** spends that cost from the system's charges and prints a chat card. Entries can be restricted by weapon type and size.

<br clear="right"/>

<img align="right" src="../img/sa-ammo-setting.png" width="30%"/>

A system's ammo is set up on its item sheet. The **Apply Fixes (LCP Data)** tool backfills official ammo descriptions and restriction data onto items that ship without them.

<br clear="right"/>

## Extra status effects

<img align="right" src="../img/sa-statuses.png" width="30%"/>

**`additionalStatuses`** (in the Statuses & FX tab) registers around seventeen statuses beyond Lancer's defaults, like Immovable, Throttled, Climber, Brace, Dazed, Resist All, and Aided, several of which carry active effects rather than just an icon.

<br clear="right"/>

## Permanent statuses

A status whose duration is set to **permanent** (in the [Effect Manager](./EFFECTS_AND_BONUSES.md)) survives a Full Repair.

## Extra trackable attributes

The module exposes **move** and **reaction** from the action tracker, plus **infection**, as token resource-bar options in the Token Config Resources tab.
