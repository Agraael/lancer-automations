# Lancer Reaction Checker

A FoundryVTT module for the LANCER system that reminds players when they can use Overwatch reactions.

## Installation

**Manifest URL:**
```
https://github.com/Agraael/lancer-reactionChecker/releases/latest/download/module.json
```

## Requirements

- [Lancer Style Library](https://github.com/Agraael/lancer-style-library) - Required for CSS styling

## Features

When an enemy token moves in combat:
- If you have **Grid Aware Auras** installed, looks for an aura named `Threat` or `Threat_detail`
- Otherwise, calculates max threat range based on the unit's equipped weapons
- If the enemy **starts** their movement within your threat range and you have a reaction available, shows a reminder (popup or chat message)

### Token Factions Integration

Works with [Token Factions fork](https://github.com/Agraael/foundryvtt-token-factions) and its advanced faction feature for accurate hostile/friendly detection.

## Configuration

Module settings allow choosing between popup dialog or chat message for reminders.

## Notes

This module may be expanded with additional features in the future.
