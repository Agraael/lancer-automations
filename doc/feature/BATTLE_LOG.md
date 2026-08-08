# Battle Log

[← Back to the README](../../README.md)

This is the first patron-requested feature. Well, sort of. I extrapolated a lot, and maybe went a bit too hard with it. It grows bit by bit, so it is not perfect yet.

So what is it? It tries to track everything that happens during a combat and hand you back a cool-ass recap at the end, like an XCom game.

<img src="../vid/bl-recap.gif" width="80%"/>

---

## Ending a combat

When a combat ends, the GM gets a card first. Pick the outcome, **SUCCESS**, **PARTIAL**, or **FAILURE**, add whatever detail lines you want, and set the **MVP** (leave it blank and it auto-picks from the awards). Hit broadcast and the sequence plays for everyone.

The rest is in the **Battle Log** settings tab: **Enable Battle Log**, **Disable awards**, and **Theme music** (a default, or one per outcome).

## A word on accuracy

Because of how Foundry works, I can't tell whether you fired something on purpose or by accident. So the more accurately you play, the more accurate the recap. For actions, the log counts an item the moment it hits the chat, that is what it reads as "used."

Past that it tracks kills, assists, accuracy, damage, movement, and saves, per token, so every grunt in a squad gets its own line.

## Squad

<img src="../vid/bl-squad.gif" width="80%"/>

One card per pilot. Each shows the mech's HP and heat, structure and stress pips, damage dealt and taken (physical/heat split in the tooltip), distance moved, kills and assists, favorite weapon and most-used action, save rates, repairs spent, core power used or held, and any gear lost. Accuracy has its own breakdown: ranged, melee, and tech hit rates, crits, and how much you dodged or blocked.

### Awards

Up top sit the awards, medals for how the fight went: most kills (**EXECUTIONER**), most physical damage (**HEAVY HITTER**), most assists (**SUPPORT**), best accuracy (**SHARPSHOOTER**), most attacks dodged (**GHOST**), and more. Each has a threshold, so it only shows when someone earns it. The **MVP** goes to whoever collected the most, unless the GM picks by hand. Not your thing? Flip **Disable awards**.

## Encounter

<img src="../vid/bl-encounter.gif" width="80%"/>

The enemy side. Each hostile gets a card: whether it died and on which round, who landed the kill and who assisted, and its tier, size, and frame. The nastiest ones pick up a **NEMESIS** or **TOP THREAT** badge.

## Telemetry

<img src="../vid/bl-telemetry.gif" width="80%"/>

The nerd tab: per-round line charts for the squad, HP, heat, damage, and kills/assists, from R0 (the start of combat) to the last round. Click a name to isolate one pilot, or toggle the squad total.
