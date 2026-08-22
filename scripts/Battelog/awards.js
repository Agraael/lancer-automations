
/**
 * @typedef {Object} AwardDefinition
 * @property {string} key
 * @property {string} label
 * @property {string} icon
 * @property {string} description
 * @property {(player: any) => number} stat        pulled from every player, top wins
 * @property {number} minValue                      top must meet this to qualify
 * @property {(value: number, player: any) => string} format   stat cell label ("12 KILLS")
 * @property {number} weight                    MVP points when held
 */

/** @type {AwardDefinition[]} */
export const AWARDS = [
    {
        key: 'EXECUTIONER',
        weight: 2,
        label: 'EXECUTIONER',
        icon: 'fa-skull',
        description: 'Confirmed three or more enemy chassis destroyed',
        stat: p => p.kills ?? 0,
        minValue: 3,
        format: v => `${v} KILLS`,
    },
    {
        key: 'HEAVY',
        weight: 3,
        label: 'HEAVY HITTER',
        icon: 'fa-explosion',
        description: 'Dealt the most physical damage across the engagement',
        stat: p => p.physicalDmgDealt ?? 0,
        minValue: 40,
        format: v => `${v} DMG`,
    },
    {
        key: 'OVERCLOCK',
        weight: 2,
        label: 'OVERCLOCK',
        icon: 'fa-temperature-arrow-up',
        description: 'Overheated enemy reactors more than anyone else',
        stat: p => p.heatDmgDealt ?? 0,
        minValue: 6,
        format: v => `${v} HEAT`,
    },
    {
        key: 'ANCHOR',
        weight: 2,
        label: 'ANCHOR',
        icon: 'fa-shield-halved',
        description: 'Absorbed the most physical damage without breaking',
        stat: p => p.destroyed ? 0 : (p.physicalDmgTaken ?? 0),
        minValue: 10,
        format: v => `${v} DMG TAKEN`,
    },
    {
        key: 'HEAT_SINK',
        weight: 1,
        label: 'HEAT SINK',
        icon: 'fa-temperature-arrow-down',
        description: 'Weathered the most incoming reactor heat',
        stat: p => p.destroyed ? 0 : (p.heatDmgTaken ?? 0),
        minValue: 1,
        format: v => `${v} HEAT TAKEN`,
    },
    {
        key: 'SUPPORT',
        weight: 3,
        label: 'SUPPORT',
        icon: 'fa-hand-holding-medical',
        description: 'Enabled the squad’s kills through positioning and tech',
        stat: p => p.assists ?? 0,
        minValue: 2,
        format: v => `${v} ASSISTS`,
    },
    {
        key: 'TURBO',
        weight: 1,
        label: 'TURBO',
        icon: 'fa-person-running',
        description: 'Covered the most ground in a single round',
        stat: p => p.bd?.movement?.maxTurn ?? 0,
        minValue: 5,
        format: v => `${v} SPACES`,
    },
    {
        key: 'SHARPSHOOTER',
        weight: 2,
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
        weight: 2,
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
        weight: 2,
        label: 'GHOST',
        icon: 'fa-ghost',
        description: 'Evaded the most incoming attacks',
        stat: p => p.bd?.dmgIn?.evaded ?? 0,
        minValue: 3,
        format: v => `${v} EVADED`,
    },
    {
        key: 'FIREWALL',
        weight: 1,
        label: 'FIREWALL',
        icon: 'fa-shield-virus',
        description: 'Blocked the most incoming tech through e-defense',
        stat: p => p.bd?.dmgIn?.edef ?? 0,
        minValue: 3,
        format: v => `${v} BLOCKED`,
    },
    {
        key: 'STEADFAST',
        weight: 2,
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
        weight: 2,
        label: 'BULLSEYE',
        icon: 'fa-eye',
        description: 'Landed the most critical hits',
        stat: p => p.bd?.acc?.crits ?? 0,
        minValue: 2,
        format: v => `${v} CRITS`,
    },
    {
        key: 'BRAWLER',
        weight: 1,
        label: 'BRAWLER',
        icon: 'fa-hand-back-fist',
        description: 'Knocked enemies around more than anyone else',
        stat: player => player.bd?.movement?.knockbackDealt ?? 0,
        minValue: 2,
        format: value => `${value} SPACES KB`,
    },
    {
        key: 'BLITZ',
        weight: 1,
        label: 'BLITZ',
        icon: 'fa-bolt-lightning',
        description: 'Most actions taken in a single turn',
        stat: player => player.maxActionsInTurn ?? 0,
        minValue: 5,
        format: value => `${value} ACTIONS`,
    },
    {
        key: 'FIRST_BLOOD',
        weight: 2,
        label: 'FIRST BLOOD',
        icon: 'fa-droplet',
        description: 'Drew first blood of the engagement',
        stat: player => player.firstBlood ?? 0,
        minValue: 1,
        format: () => 'FIRST KILL',
    },
    {
        key: 'AVENGER',
        weight: 2,
        label: 'AVENGER',
        icon: 'fa-scale-balanced',
        description: 'Destroyed the enemies that took squadmates down',
        stat: player => player.avengerKills ?? 0,
        minValue: 1,
        format: value => `${value} AVENGED`,
    },
    {
        key: 'OVERKILL',
        weight: 2,
        label: 'OVERKILL',
        icon: 'fa-burst',
        description: 'Landed the single biggest hit of the battle',
        stat: player => player.maxHit ?? 0,
        minValue: 12,
        format: value => `${value} ONE HIT`,
    },
    {
        key: 'SURVIVOR',
        weight: 2,
        label: 'SURVIVOR',
        icon: 'fa-heart-crack',
        description: 'Walked away closest to death',
        stat: player => player.survivorScore ?? 0,
        minValue: 1,
        format: (_value, player) => player.survivorLabel ?? 'BARELY ALIVE',
    },
    {
        key: 'UNTOUCHABLE',
        weight: 2,
        label: 'UNTOUCHABLE',
        icon: 'fa-wind',
        description: 'Under fire all mission without taking a scratch',
        stat: player =>
        {
            const drawn = (player.bd?.dmgIn?.attacksTaken ?? 0) + (player.bd?.dmgIn?.techTaken ?? 0);
            return drawn >= 4 && (player.dmgTaken ?? 0) === 0 ? drawn : 0;
        },
        minValue: 4,
        format: value => `${value} ATK · 0 DMG`,
    },
    {
        key: 'REDLINE',
        weight: 1,
        label: 'REDLINE',
        icon: 'fa-gauge-high',
        description: 'Rode the danger zone without stressing out',
        stat: player => player.redlineRounds ?? 0,
        minValue: 2,
        format: value => `${value} ROUNDS HOT`,
    },
    {
        key: 'DUELIST',
        weight: 1,
        label: 'DUELIST',
        icon: 'fa-swords',
        description: 'Landed the most melee hits',
        stat: player => player.bd?.acc?.meleeHits ?? 0,
        minValue: 3,
        format: value => `${value} MELEE HITS`,
    },
    {
        key: 'CROWD_CONTROL',
        weight: 2,
        label: 'CROWD CONTROL',
        icon: 'fa-users',
        description: 'Hit the most separate targets in one round',
        stat: player => player.maxTargetsOneRound ?? 0,
        minValue: 3,
        format: value => `${value} IN ONE ROUND`,
    },
    {
        key: 'LIGHTNING_ROD',
        weight: 1,
        label: 'LIGHTNING ROD',
        icon: 'fa-magnet',
        description: 'Drew more enemy fire than anyone else',
        stat: player => (player.bd?.dmgIn?.attacksTaken ?? 0) + (player.bd?.dmgIn?.techTaken ?? 0),
        minValue: 5,
        format: value => `${value} ATTACKS DRAWN`,
    },
    {
        key: 'REFLEX',
        weight: 1,
        label: 'REFLEX',
        icon: 'fa-stopwatch',
        description: 'Used the most reactions',
        stat: player => player.reactionsUsed ?? 0,
        minValue: 2,
        format: value => `${value} REACTIONS`,
    },
    {
        key: 'RECON',
        weight: 1,
        label: 'RECON',
        icon: 'fa-satellite-dish',
        description: 'Scanned the most enemy signatures',
        stat: player => player.scans ?? 0,
        minValue: 2,
        format: value => `${value} SCANS`,
    },
    {
        key: 'ARSONIST',
        weight: 1,
        label: 'ARSONIST',
        icon: 'fa-fire',
        description: 'Spread the most burn and infection',
        stat: player => (player.bd?.dmgOut?.types ?? [])
            .filter(type => type.k === 'BURN' || type.k === 'INFECTION')
            .reduce((sum, type) => sum + type.v, 0),
        minValue: 5,
        format: (value, player) =>
        {
            const types = player.bd?.dmgOut?.types ?? [];
            const burn = types.find(type => type.k === 'BURN')?.v ?? 0;
            const infection = types.find(type => type.k === 'INFECTION')?.v ?? 0;
            if (burn > 0 && infection > 0)
                return `${value} BURN+INF`;
            return `${value} ${infection > 0 ? 'INFECTION' : 'BURN'}`;
        },
    },
    {
        key: 'COOL_HEAD',
        weight: 1,
        label: 'COOL HEAD',
        icon: 'fa-fan',
        description: 'Vented the most reactor heat',
        stat: player => player.heatCooled ?? 0,
        minValue: 6,
        format: value => `${value} HEAT VENTED`,
    },
    {
        key: 'GREASE_MONKEY',
        weight: 1,
        label: 'GREASE MONKEY',
        icon: 'fa-wrench',
        description: 'Recovered the most hit points in the field',
        stat: player => player.hpRestored ?? 0,
        minValue: 5,
        format: value => `${value} HP RECOVERED`,
    },
];
