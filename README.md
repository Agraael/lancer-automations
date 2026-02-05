# Lancer Reaction Checker

A FoundryVTT module for the LANCER system that automates reactions, scripted reminders for item actions, or just global triggers.

## Installation

**Manifest URL:**
```
https://github.com/Agraael/lancer-reactionChecker/releases/latest/download/module.json
```

### Requirements

- FoundryVTT v12+
- [Lancer System](https://foundryvtt.com/packages/lancer)
- [Lancer Style Library](https://github.com/Agraael/lancer-style-library)
- [CodeMirror](https://github.com/League-of-Foundry-Developers/codemirror-lib) (Optional, for syntax highlighting)

## How It Works

The module uses a list of triggers: `onHit`, `onAttack`, `onMove`, etc. When an actor does something that corresponds to a trigger, it fires. Other tokens (including the actor itself) can react to it.

You can write an evaluation function that returns `true` to validate the activation. For item-based activations, you can also specify a specific action from an item using the Action Path (useful for reactions provided by a weapon or system).

By default, a popup appears showing all activations that have been triggered and which actors can respond.

### Example: Overwatch

Overwatch is a built-in general activation listening to `onMove`. When any token moves, other actors can listen to this trigger. The evaluation checks "did it move within your threat range?" and returns `true` if so, allowing actors with available reactions to respond.

### Activation Types

You can also add Macro or JavaScript code to run either:
- When clicking "Activate" in the summary popup
- Automatically (skipping the popup entirely)

This allows you to set up reminders or fully automate macros/code upon item usage.

### Example: Item with On-Crit Effect

Let's say you have an item with LID `big_gun` that deploys something on a critical hit.

1. Create an activation with that item's LID, listening to `onHit`
2. By default, any actor with this item would trigger on any hit. Toggle **React to Self** so only the item owner triggers it
3. But this still fires on any hit you make while owning the item. Toggle **Only On Source Match** so it only triggers when that specific item is used (note: this limits compatible triggers - things like `onMove` can't be triggered by items)
4. In the evaluate function, check the data package from `onHit`, look at `hitTarget` for a crit, return `true` if found
5. The item now appears in the summary popup for `onHit` events
6. Add activation code to deploy the effect. If you enable **Auto Activate**, the code runs automatically without showing in the summary

## Configuration

Access via: **Configure Settings > Module Settings > Lancer Reaction Checker > Reactions Configuration**

### Trigger Types

| Trigger | Event |
|---------|-------|
| `onMove` | Token movement starts |
| `onAttack` | Attack roll made |
| `onHit` | Attack roll hits |
| `onMiss` | Attack roll misses |
| `onCrit` | Critical hit |
| `onDamage` | Damage is applied |
| `onTechAttack` | Tech attack made |
| `onTechHit` | Tech attack hits |
| `onTechMiss` | Tech attack misses |
| `onStructure` | Structure damage taken |
| `onStress` | Heat stress applied |
| `onActivation` | Item activated |
| `onStartOfTurn` | Combat turn starts |
| `onEndOfTurn` | Combat turn ends |

### Activation Properties

| Property | Description |
|----------|-------------|
| Item LID | Lancer Item ID (item-based only) |
| Action Path | Path to action data in item (e.g., `system.actions.0`) |
| Triggers | Which events to listen for |
| Trigger Description | Displayed trigger text |
| Effect Description | Displayed effect text |
| Action Type | Reaction, Free Action, Quick Action, etc. |
| Frequency | 1/round, 1/turn, unlimited, etc. |
| Consumes Reaction | Whether using this consumes the token's reaction |
| Auto Activate | Skip popup and run activation automatically |
| React to Self | Allow token to react to its own triggers |
| React to Others | Allow reacting to other tokens' triggers |
| Only On Source Match | Only trigger when the source item/action matches |
| Activation Type | None, Flow (chat card), Macro, or JavaScript |
| Activation Mode | Run after or instead of the flow |

### Evaluate Function

The evaluate function determines if an activation should trigger. It receives:
- `triggerType` - Which trigger fired
- `data` - Trigger-specific data (targets, damage, positions, etc.)
- `reactorToken` - The token that might react
- `item` - The item (for item-based activations)

Must return `true` or `false`.

## Export & Import

You can export and import activations to share with others. Overwatch is provided as a default. The rest depends on what people find useful - the system is flexible enough to automate most things.

## Utilities

- **LID Item Finder** - Helps you find item LIDs in your world
- **Debug Mode** - Enable console logging for troubleshooting

## API

```javascript
const api = game.modules.get('lancer-reactionChecker').api;

api.checkOverwatchCondition(reactorToken, moverToken, startPos)
api.getActorMaxThreat(actor)
api.getTokenDistance(token1, token2)
api.isHostile(token1, token2)
api.isFriendly(token1, token2)
```

## Experimental Boost Detection (WIP)

This feature tracks cumulative token movement during a turn to detect when a Boost action is used.

### Requirements

- [Elevation Ruler](https://foundryvtt.com/packages/elevationruler) or [Lancer Elevation Ruler Fork](https://github.com/Agraael/fvtt-lancer-elevation-ruler)

### How It Works

When enabled, the module tracks cumulative drag movement for each token. When movement exceeds the token's base speed, a boost is detected. The `onMove` trigger data includes:

- `moveInfo.isBoost` - `true` if this move crossed a boost threshold
- `moveInfo.boostSet` - Array of boost numbers crossed (e.g., `[1]` for first boost, `[1,2]` if a single long move crossed multiple thresholds)

### Testing

1. Enable **Experimental Boost Detection (WIP)** in module settings
2. Enable **Debug Boost Detection** to see UI notifications showing cumulative movement and boost detection
3. Drag a token to move it - notifications will show `moved X, cumulative Y/Z | isBoost: true/false, boostSet: [...]`

### API

```javascript
// Manually reset cumulative movement data for a token
game.modules.get("lancer-reactionChecker").api.clearMoveData(tokenDocumentId)
```

Cumulative movement automatically resets when a token's turn starts.

## Support

For help or questions, ask on the [Pilot NET Discord](https://discord.gg/pilot-net).
