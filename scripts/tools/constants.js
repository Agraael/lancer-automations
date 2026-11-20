// Single source of truth for the settings, flag, socket and keybinding namespace.
export const MODULE_ID = 'lancer-automations';

// Eye height of the target an empty hex is judged for under the trig rule, shared by the pulse and the sweep peek.
export const LOS_TARGET_ABOVE = 1;

export const PILOT_LINKED_ITEM_TYPES = ['talent', 'bond'];
export const COMBAT_VIEW_KEYS = ['round', 'turn', 'active', 'scene', 'combatants'];
export const RUNS_ON_CHOICES = ['mech', 'pilot', 'both'];
export const CUSTOM_STATUS_ICON = 'systems/lancer/assets/icons/white/d20-framed.svg';

// Shared so the TAH row and the boost offer card print the same text.
export const BOOST_DETAIL = 'Move at least 1 space, up to your SPEED, on top of your standard move. Some talents and systems only work on a BOOST, not a standard move.<br><br>Raises your movement cap by your SPEED. Drag to move.';

export const BASIC_DETAIL = {
    skirmish: 'When you SKIRMISH, you attack with a single weapon MOUNT. \r \n To SKIRMISH, choose a mount and a valid target within RANGE (or THREAT), then make an attack with the primary weapon on that mount. \r &bull; You may also attack with an AUXILIARY weapon on the same mount. That weapon does not deal bonus damage. \r &bull; SUPERHEAVY weapons are too cumbersome to use in a SKIRMISH, and can only be fired as part of a BARRAGE.',
    ram: 'When you RAM, you make a melee attack with the aim of knocking a target down or back. \r \n To RAM, make a melee attack against an adjacent character the same SIZE or smaller than you. On a success, your target is knocked PRONE and you may also choose to knock them back by one space, directly away from you.',
    grapple: 'When you GRAPPLE, you grab hold of a target to overpower them. \r \n To GRAPPLE, choose an adjacent character and make a melee attack. On a hit: \r &bull; both characters become ENGAGED; \r &bull; neither can BOOST or take reactions while grappled; \r &bull; the smaller becomes IMMOBILIZED and is dragged when the larger moves. If same SIZE, contested HULL check at start of turn decides who is larger. \r \n A GRAPPLE ends when adjacency breaks, the attacker ends it as a free action, or the defender wins a contested HULL check as a quick action.',
    scan: 'Choose a character or object within SENSORS and line of sight, then ask the GM for one of: its full statistics and loadout, one piece of hidden information, or generic public information. Only current at the time of the SCAN.',
    lockOn: 'Choose a character within SENSORS and line of sight. They gain the LOCK ON condition. Any character making an attack against a character with LOCK ON may choose to gain +1 Accuracy on that attack and then clear the LOCK ON condition after that attack resolves.',
    bolster: 'Choose a character within SENSORS. They receive +2 Accuracy on the next skill check or save they make between now and the end of their next turn. Characters can only benefit from one BOLSTER at a time.',
    invade: 'Make a tech attack against a target. On success, deal 2 heat and choose one of the available Invade options.',
    hide: 'Obscure the position of your mech, becoming HIDDEN and unable to be identified, precisely located, or be targeted directly by attacks or hostile actions.',
    search: 'Choose a character within your SENSORS that you suspect is HIDDEN and make a contested SYSTEMS check against their AGILITY. Once a HIDDEN character has been found using SEARCH, they immediately lose HIDDEN and can be located again by any character.',
    hidePilot: 'Obscure your position, becoming HIDDEN and unable to be identified, precisely located, or targeted directly by attacks or hostile actions.',
    searchPilot: 'As a pilot on foot, make a contested skill check, adding bonuses from triggers as normal. This can be used to reveal characters within RANGE 5. Once a HIDDEN character has been found using SEARCH, they immediately lose HIDDEN and can be located again by any character.',
};
