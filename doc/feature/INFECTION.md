# Infection

[← Back to Home](../index.md)

Infection is a damage type from [HORUS: Thy Hubris Manifest](https://cornylius.itch.io/thy-hubris-manifest) (by P.B. Cornylius), a heat-based cousin of Burn. Lancer Automations adds it, with the end-of-turn check and tracking on the sheet.

---

## Settings

<img align="right" src="../img/inf-settings.png" width="45%"/>

**Combat & Movement → Structure & Damage**, the **Infection Damage Type** toggle (**`enableInfectionDamageIntegration`**).

<br clear="right"/>

---

## How it works

<img align="right" src="../img/inf-check.png" width="45%"/>

Taking infection deals **Heat equal to the infection value** straight away, and stacks if the target already has some.

At the end of its turn the token rolls a **Systems check**: on a success all infection clears, on a failure it takes Heat equal to its current infection.

Anything that clears Burn (**Stabilize** or a **Full Repair**) clears infection too.

<br clear="right"/>

---

## Dealing it

<img align="right" src="../img/inf-card.png" width="45%"/>

**Infection** is a weapon damage type alongside Kinetic, Energy, and the rest. Infection resistance halves it and infection vulnerability doubles it, though the Heat it deals can't be resisted.

When an attack deals it, the infection amount is added to the system's own "took X damage" message. There's no extra button: the system's **Apply damage** applies the infection too, and its **Undo** takes the infection Heat back out with the damage.

<br clear="right"/>

---

## On the sheet

<img align="right" src="../img/inf-sheet.png" width="45%"/>

An **Infection** card sits next to Burn on the sheet, with a value field and a button to roll the end-of-turn check by hand. On the alt sheet it's a bare **INFX** field next to Burn, with no roll button.

Infection is tracked on the actor. For mechs and NPCs it's also a token bar option, in the Token Config Resources tab. Pilots don't get it.

<br clear="right"/>
