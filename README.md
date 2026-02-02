# Lancer Reaction Checker

A FoundryVTT module for the LANCER system that automates reaction detection and prompts players when reactions can be triggered.

## Installation

**Manifest URL:**
```
https://github.com/Agraael/lancer-reactionChecker/releases/latest/download/module.json
```

## Requirements

- FoundryVTT v12+
- [Lancer System](https://foundryvtt.com/packages/lancer)
- [Lancer Style Library](https://github.com/Agraael/lancer-style-library) - CSS styling
- [CodeMirror](https://github.com/League-of-Foundry-Developers/codemirror-lib) (Optional) - For syntax highlighting in code editors

## Features

### Trigger Types

The module monitors the following game events:

| Trigger | Event |
|---------|-------|
| `onMove` | Token movement starts |
| `onHit` | Attack roll hits |
| `onMiss` | Attack roll misses |
| `onCrit` | Critical hit |
| `onDamage` | Damage is applied |
| `onTechHit` | Tech attack hits |
| `onTechMiss` | Tech attack misses |
| `onStructure` | Structure damage taken |
| `onStress` | Heat stress applied |
| `onCheck` | Skill check made |
| `onReaction` | Another reaction triggered |
| `onStartOfTurn` | Combat turn starts |
| `onEndOfTurn` | Combat turn ends |

### Reaction Types

**Item Reactions** - Linked to specific items (weapons, systems, talents, NPC features). Identified by item LID. Automatically checks item availability (uses, loaded state, destroyed).

**General Reactions** - Not linked to items. Custom conditions and effects.

## Configuration

Access via: `Configure Settings > Module Settings > Lancer Reaction Checker > Reactions Configuration`

### Reaction Properties

| Property | Description |
|----------|-------------|
| `name` | Display name |
| `lid` | Lancer Item ID (item reactions only) |
| `reactionPath` | Path to action data in item (e.g., `system.actions.0`) |
| `triggers` | Array of trigger types |
| `triggerDescription` | Displayed trigger text |
| `effectDescription` | Displayed effect text |
| `evaluate` | JavaScript code returning boolean. Context: `token`, `actor`, `data` |
| `enabled` | Toggle reaction on/off |
| `activationType` | `none`, `code`, or `macro` |
| `activationMode` | `after` (after chat) or `instead` (replace chat) |
| `activationCode` | JS code for `code` type |
| `activationMacro` | Macro name for `macro` type |

### Evaluate Context

The `evaluate` function receives:
- `token` - Reactor's token document
- `actor` - Reactor's actor document
- `data` - Trigger-specific data object

**Data properties by trigger:**

| Trigger | Data Properties |
|---------|-----------------|
| `onMove` | `mover`, `startPos`, `endPos` |
| `onHit/Miss/Crit` | `attacker`, `target`, `weapon`, `damage` |
| `onDamage` | `attacker`, `target`, `damageResults` |
| `onTechHit/Miss` | `attacker`, `target`, `techType` |
| `onStructure/Stress` | `actor`, `result` |
| `onCheck` | `actor`, `checkType`, `result` |
| `onStartOfTurn/EndOfTurn` | `combatant`, `combat` |

## API

```javascript
const api = game.modules.get('lancer-reactionChecker').api;

// Functions
api.checkOverwatchCondition(reactorToken, moverToken, startPos) // boolean
api.getActorMaxThreat(actor) // number
api.getTokenDistance(token1, token2) // number
api.isHostile(token1, token2) // boolean
api.isFriendly(token1, token2) // boolean
api.getMinGridDistance(token, hexCenter) // number

// Debug (temporary)
api.drawThreatDebug(token) // Draws threat range overlay
api.drawDistanceDebug(token1, token2) // Draws distance line
```

## Module Settings

| Setting | Description |
|---------|-------------|
| Show Popup | Display popup dialog vs chat message |
| Debug Mode | Enable console logging |

## Default Reactions

Default reactions are included and will be expanded over time.

### Overwatch (General)
- **Trigger:** `onMove`
- **Condition:** Hostile starts movement in threat range, reactor has reaction available

### Hunker Down (NPC Feature)
- **LID:** `npc-rebake_npcf_trait_hunker_down`
- **Trigger:** `onHit`
- **Condition:** Target is the reactor

## Adding Custom Reactions

1. Open Reactions Configuration
2. Click "Add Reaction" or "Add General Reaction"
3. Fill in properties:
   - Set trigger(s)
   - Write evaluate condition
   - Optionally configure activation code/macro
4. Save

## Notes

- Reactions are evaluated per-token when triggers fire
- Item reactions auto-check: uses remaining, loaded state, not destroyed
- General reactions require manual availability logic in evaluate
- Popup shows to token owner only

## Support

For help or questions, ask on the [Pilot NET Discord](https://discord.gg/pilot-net).
