// Raw event log emitted by a Lancer combat. All ids inside events are TOKEN ids.

/**
 * skill     - skill trigger from the pilot sheet
 * save      - forced HASE save, name is hull|agi|sys|eng
 * check     - voluntary HASE roll, name is hull|agi|sys|eng
 * defensive - OVERWATCH, BRACE, ... (reactions)
 * utility   - STABILIZE, PROTOCOL, SELF REPAIR, CORE POWER, ...
 * @typedef {'skill'|'save'|'check'|'defensive'|'utility'} ActionCategory
 */

/** @typedef {'kinetic'|'energy'|'explosive'|'variable'|'heat'|'burn'|'infection'} DamageType */

/**
 * @typedef {Object} DamageInstance
 * @property {DamageType} type
 * @property {number} amount
 */

/**
 * A HASE save/check, skill trigger, or resolved activation.
 * @typedef {Object} ActionEvent
 * @property {'action'} type
 * @property {number} round
 * @property {string} byId
 * @property {ActionCategory} category
 * @property {string} name                    hull|agi|sys|eng for saves and checks; label otherwise
 * @property {boolean} success
 */

/**
 * A weapon or tech attack roll against one or more targets.
 * @typedef {Object} AttackEvent
 * @property {'attack'} type
 * @property {number} round
 * @property {string} byId
 * @property {'weapon'|'tech'} category
 * @property {string} weaponName
 * @property {'Ranged'|'Melee'|'Tech'|null} [attackType]
 * @property {boolean} [basic]                true for BASIC ATTACK / BASIC TECH (not a real weapon)
 * @property {Array<{targetId: string, hit: boolean, defense: 'evasion'|'edef', crit?: boolean, roll?: number}>} targets
 */

/**
 * Damage landed on a target. byId = attacker token, or the target itself when sourceless.
 * @typedef {Object} DamageEvent
 * @property {'damage'} type
 * @property {number} round
 * @property {string} byId
 * @property {string} targetId
 * @property {DamageInstance[]} damages
 * @property {number} hpLanded
 * @property {number} overshieldAbsorbed
 * @property {number} armorAbsorbed
 * @property {boolean} [manual]               GM edit detected at tick, not a damage card
 */

/**
 * Undo of a damage card.
 * @typedef {Object} DamageUndoEvent
 * @property {'damage-undo'} type
 * @property {number} round
 * @property {string} byId
 * @property {string} targetId
 * @property {number} hpRestored
 * @property {number} overshieldRestored
 */

/**
 * @typedef {Object} MoveEvent
 * @property {'move'} type
 * @property {number} round
 * @property {string} byId
 * @property {number} distance                grid spaces
 * @property {boolean} knockback              true = forced by an outside effect
 */

/**
 * Vitals snapshot, emitted at each turn and round end for every living combatant.
 * The recap builds the HP and heat lines from these; heatPeak is max(heat).
 * @typedef {Object} StatTickEvent
 * @property {'stat-tick'} type
 * @property {number} round
 * @property {string} tokenId
 * @property {number} hp
 * @property {number} heat
 * @property {number} structure
 * @property {number} stress
 * @property {number} burn
 * @property {number} infection
 * @property {number} overshield
 * @property {number} repairs
 */

/**
 * @typedef {Object} StructureLossEvent
 * @property {'structure-loss'} type
 * @property {number} round
 * @property {string} tokenId
 */

/**
 * @typedef {Object} StressLossEvent
 * @property {'stress-loss'} type
 * @property {number} round
 * @property {string} tokenId
 */

/**
 * A weapon or system on the combatant is destroyed during the fight.
 * @typedef {Object} GearLostEvent
 * @property {'gear-lost'} type
 * @property {number} round
 * @property {string} tokenId
 * @property {'weapon'|'system'} kind
 * @property {string} name                    display label
 */

/**
 * Fires once when the combatant is destroyed. Kill / assist are attributed at
 * death time, so killerId is null when it died un-attacked (burn, self, GM).
 * @typedef {Object} DestroyedEvent
 * @property {'destroyed'} type
 * @property {number} round
 * @property {string} tokenId
 * @property {string|null} [killerId]
 * @property {string[]} [assistIds]
 */

/**
 * @typedef {ActionEvent
 *   | AttackEvent
 *   | DamageEvent
 *   | DamageUndoEvent
 *   | MoveEvent
 *   | StatTickEvent
 *   | StructureLossEvent
 *   | StressLossEvent
 *   | GearLostEvent
 *   | DestroyedEvent
 * } TelemetryEvent
 */

/**
 * @typedef {Object} CombatantLog
 * @property {string} tokenId                 entry key; ids inside events are token ids
 * @property {string} actorId                 for render-time actor lookups
 * @property {string} [name]                  token name, captured at track time
 * @property {TelemetryEvent[]} events        chronological, each stamped with a global seq
 */

/**
 * @typedef {Object} CombatTelemetry
 * @property {number} startTime                 ms since epoch when combat opened
 * @property {number} endTime                   ms since epoch when combat closed
 * @property {number} roundCount                total rounds elapsed
 * @property {CombatantLog[]} players
 * @property {CombatantLog[]} hostiles
 * @property {CombatantLog[]} [friendlies]
 * @property {CombatantLog[]} [neutrals]
 * @property {CombatantLog[]} [secrets]
 */

export const ACTION_CATEGORIES = /** @type {ActionCategory[]} */ (['skill', 'check', 'save', 'defensive', 'utility']);
export const DAMAGE_TYPES = /** @type {DamageType[]} */ (['kinetic', 'energy', 'explosive', 'variable', 'heat', 'burn', 'infection']);
export const DOT_TYPES = /** @type {DamageType[]} */ (['burn', 'infection']);
export const SAVE_KINDS = /** @type {const} */ (['hull', 'agi', 'sys', 'eng']);
export const EVENT_TYPES = ['attack', 'damage', 'damage-undo', 'action', 'move', 'stat-tick', 'structure-loss', 'stress-loss', 'gear-lost', 'destroyed'];
