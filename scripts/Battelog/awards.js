
/**
 * @typedef {Object} AwardDefinition
 * @property {string} key
 * @property {string} label
 * @property {string} icon
 * @property {string} description
 * @property {(player: any) => number} stat        pulled from every player, top wins
 * @property {number} minValue                      top must meet this to qualify
 * @property {(value: number, player: any) => string} format   stat cell label ("12 KILLS")
 */

/** @type {AwardDefinition[]} */
export const AWARDS = [
    {
        key: 'EXECUTIONER',
        label: 'EXECUTIONER',
        icon: 'fa-skull',
        description: 'Confirmed three or more enemy chassis destroyed',
        stat: p => p.kills ?? 0,
        minValue: 3,
        format: v => `${v} KILLS`,
    },
    {
        key: 'HEAVY',
        label: 'HEAVY HITTER',
        icon: 'fa-explosion',
        description: 'Dealt the most physical damage across the engagement',
        stat: p => p.physicalDmgDealt ?? 0,
        minValue: 40,
        format: v => `${v} DMG`,
    },
    {
        key: 'OVERCLOCK',
        label: 'OVERCLOCK',
        icon: 'fa-temperature-arrow-up',
        description: 'Overheated enemy reactors more than anyone else',
        stat: p => p.heatDmgDealt ?? 0,
        minValue: 6,
        format: v => `${v} HEAT`,
    },
    {
        key: 'ANCHOR',
        label: 'ANCHOR',
        icon: 'fa-shield-halved',
        description: 'Absorbed the most physical damage without breaking',
        stat: p => p.destroyed ? 0 : (p.physicalDmgTaken ?? 0),
        minValue: 1,
        format: v => `${v} DMG TAKEN`,
    },
    {
        key: 'HEAT_SINK',
        label: 'HEAT SINK',
        icon: 'fa-temperature-arrow-down',
        description: 'Weathered the most incoming reactor heat',
        stat: p => p.destroyed ? 0 : (p.heatDmgTaken ?? 0),
        minValue: 1,
        format: v => `${v} HEAT TAKEN`,
    },
    {
        key: 'SUPPORT',
        label: 'SUPPORT',
        icon: 'fa-hand-holding-medical',
        description: 'Enabled the squad’s kills through positioning and tech',
        stat: p => p.assists ?? 0,
        minValue: 1,
        format: v => `${v} ASSISTS`,
    },
    {
        key: 'MOVER',
        label: 'MOVER',
        icon: 'fa-person-running',
        description: 'Covered the most ground across the engagement',
        stat: p => p.moves ?? 0,
        minValue: 5,
        format: v => `${v} SPACES`,
    },
    {
        key: 'SHARPSHOOTER',
        label: 'SHARPSHOOTER',
        icon: 'fa-bullseye',
        description: 'Highest hit rate on weapon attacks',
        stat: p =>
        {
            const rangedShots = p.bd?.acc?.rangedShots ?? 0;
            const meleeShots = p.bd?.acc?.meleeShots ?? 0;
            if (rangedShots + meleeShots < 3)
                return 0;
            return p.accuracy ?? 0;
        },
        minValue: 50,
        format: v => `${v}%`,
    },
    {
        key: 'HACKER',
        label: 'HACKER',
        icon: 'fa-microchip',
        description: 'Highest hit rate on tech attacks',
        stat: p =>
        {
            const techShots = p.bd?.acc?.techShots ?? 0;
            if (techShots < 3)
                return 0;
            return p.bd?.acc?.tech ?? 0;
        },
        minValue: 50,
        format: v => `${v}%`,
    },
    {
        key: 'GHOST',
        label: 'GHOST',
        icon: 'fa-ghost',
        description: 'Evaded the most incoming attacks',
        stat: p => p.bd?.dmgIn?.evaded ?? 0,
        minValue: 3,
        format: v => `${v} EVADED`,
    },
    {
        key: 'FIREWALL',
        label: 'FIREWALL',
        icon: 'fa-shield-virus',
        description: 'Blocked the most incoming tech through e-defense',
        stat: p => p.bd?.dmgIn?.edef ?? 0,
        minValue: 3,
        format: v => `${v} BLOCKED`,
    },
    {
        key: 'STEADFAST',
        label: 'STEADFAST',
        icon: 'fa-hand-fist',
        description: 'Highest H.A.S.E success rate',
        stat: p =>
        {
            const attempts = p.bd?.hase?.total?.attempts ?? 0;
            if (attempts < 3)
                return 0;
            return p.bd?.hase?.total?.rate ?? 0;
        },
        minValue: 50,
        format: v => `${v}%`,
    },
    {
        key: 'BULLSEYE',
        label: 'BULLSEYE',
        icon: 'fa-eye',
        description: 'Landed the most critical hits',
        stat: p => p.bd?.acc?.crits ?? 0,
        minValue: 2,
        format: v => `${v} CRITS`,
    },
    {
        key: 'BRAWLER',
        label: 'BRAWLER',
        icon: 'fa-hand-back-fist',
        description: 'Knocked enemies around more than anyone else',
        stat: player => player.bd?.movement?.knockbackDealt ?? 0,
        minValue: 2,
        format: value => `${value} SPACES KB`,
    },
    {
        key: 'BLITZ',
        label: 'BLITZ',
        icon: 'fa-bolt-lightning',
        description: 'Most actions taken in a single turn',
        stat: player => player.maxActionsInTurn ?? 0,
        minValue: 5,
        format: value => `${value} ACTIONS`,
    },
];
