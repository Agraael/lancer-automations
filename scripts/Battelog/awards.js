
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
        label: 'LA.award.EXECUTIONER.label',
        icon: 'fa-skull',
        description: 'LA.award.EXECUTIONER.description',
        stat: p => p.kills ?? 0,
        minValue: 3,
        format: v => `${v} KILLS`,
    },
    {
        key: 'HEAVY',
        weight: 3,
        label: 'LA.award.HEAVY.label',
        icon: 'fa-explosion',
        description: 'LA.award.HEAVY.description',
        stat: p => p.physicalDmgDealt ?? 0,
        minValue: 40,
        format: v => `${v} DMG`,
    },
    {
        key: 'OVERCLOCK',
        weight: 2,
        label: 'LA.award.OVERCLOCK.label',
        icon: 'fa-temperature-arrow-up',
        description: 'LA.award.OVERCLOCK.description',
        stat: p => p.heatDmgDealt ?? 0,
        minValue: 6,
        format: v => `${v} HEAT`,
    },
    {
        key: 'ANCHOR',
        weight: 2,
        label: 'LA.award.ANCHOR.label',
        icon: 'fa-shield-halved',
        description: 'LA.award.ANCHOR.description',
        stat: p => p.destroyed ? 0 : (p.physicalDmgTaken ?? 0),
        minValue: 10,
        format: v => `${v} DMG TAKEN`,
    },
    {
        key: 'HEAT_SINK',
        weight: 1,
        label: 'LA.award.HEAT_SINK.label',
        icon: 'fa-temperature-arrow-down',
        description: 'LA.award.HEAT_SINK.description',
        stat: p => p.destroyed ? 0 : (p.heatDmgTaken ?? 0),
        minValue: 1,
        format: v => `${v} HEAT TAKEN`,
    },
    {
        key: 'SUPPORT',
        weight: 3,
        label: 'LA.award.SUPPORT.label',
        icon: 'fa-hand-holding-medical',
        description: 'LA.award.SUPPORT.description',
        stat: p => p.assists ?? 0,
        minValue: 2,
        format: v => `${v} ASSISTS`,
    },
    {
        key: 'TURBO',
        weight: 1,
        label: 'LA.award.TURBO.label',
        icon: 'fa-person-running',
        description: 'LA.award.TURBO.description',
        stat: p => p.bd?.movement?.maxTurn ?? 0,
        minValue: 5,
        format: v => `${v} SPACES`,
    },
    {
        key: 'SHARPSHOOTER',
        weight: 2,
        label: 'LA.award.SHARPSHOOTER.label',
        icon: 'fa-bullseye',
        description: 'LA.award.SHARPSHOOTER.description',
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
        label: 'LA.award.HACKER.label',
        icon: 'fa-microchip',
        description: 'LA.award.HACKER.description',
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
        label: 'LA.award.GHOST.label',
        icon: 'fa-ghost',
        description: 'LA.award.GHOST.description',
        stat: p => p.bd?.dmgIn?.evaded ?? 0,
        minValue: 3,
        format: v => `${v} EVADED`,
    },
    {
        key: 'FIREWALL',
        weight: 1,
        label: 'LA.award.FIREWALL.label',
        icon: 'fa-shield-virus',
        description: 'LA.award.FIREWALL.description',
        stat: p => p.bd?.dmgIn?.edef ?? 0,
        minValue: 3,
        format: v => `${v} BLOCKED`,
    },
    {
        key: 'STEADFAST',
        weight: 2,
        label: 'LA.award.STEADFAST.label',
        icon: 'fa-hand-fist',
        description: 'LA.award.STEADFAST.description',
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
        label: 'LA.award.BULLSEYE.label',
        icon: 'fa-eye',
        description: 'LA.award.BULLSEYE.description',
        stat: p => p.bd?.acc?.crits ?? 0,
        minValue: 2,
        format: v => `${v} CRITS`,
    },
    {
        key: 'BRAWLER',
        weight: 1,
        label: 'LA.award.BRAWLER.label',
        icon: 'fa-hand-back-fist',
        description: 'LA.award.BRAWLER.description',
        stat: player => player.bd?.movement?.knockbackDealt ?? 0,
        minValue: 2,
        format: value => `${value} SPACES KB`,
    },
    {
        key: 'BLITZ',
        weight: 1,
        label: 'LA.award.BLITZ.label',
        icon: 'fa-bolt-lightning',
        description: 'LA.award.BLITZ.description',
        stat: player => player.maxActionsInTurn ?? 0,
        minValue: 5,
        format: value => `${value} ACTIONS`,
    },
    {
        key: 'FIRST_BLOOD',
        weight: 2,
        label: 'LA.award.FIRST_BLOOD.label',
        icon: 'fa-droplet',
        description: 'LA.award.FIRST_BLOOD.description',
        stat: player => player.firstBlood ?? 0,
        minValue: 1,
        format: () => 'FIRST KILL',
    },
    {
        key: 'AVENGER',
        weight: 2,
        label: 'LA.award.AVENGER.label',
        icon: 'fa-scale-balanced',
        description: 'LA.award.AVENGER.description',
        stat: player => player.avengerKills ?? 0,
        minValue: 1,
        format: value => `${value} AVENGED`,
    },
    {
        key: 'OVERKILL',
        weight: 2,
        label: 'LA.award.OVERKILL.label',
        icon: 'fa-burst',
        description: 'LA.award.OVERKILL.description',
        stat: player => player.maxHit ?? 0,
        minValue: 12,
        format: value => `${value} ONE HIT`,
    },
    {
        key: 'SURVIVOR',
        weight: 2,
        label: 'LA.award.SURVIVOR.label',
        icon: 'fa-heart-crack',
        description: 'LA.award.SURVIVOR.description',
        stat: player => player.survivorScore ?? 0,
        minValue: 1,
        format: (_value, player) => player.survivorLabel ?? 'BARELY ALIVE',
    },
    {
        key: 'UNTOUCHABLE',
        weight: 2,
        label: 'LA.award.UNTOUCHABLE.label',
        icon: 'fa-wind',
        description: 'LA.award.UNTOUCHABLE.description',
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
        label: 'LA.award.REDLINE.label',
        icon: 'fa-gauge-high',
        description: 'LA.award.REDLINE.description',
        stat: player => player.redlineRounds ?? 0,
        minValue: 2,
        format: value => `${value} ROUNDS HOT`,
    },
    {
        key: 'DUELIST',
        weight: 1,
        label: 'LA.award.DUELIST.label',
        icon: 'fa-swords',
        description: 'LA.award.DUELIST.description',
        stat: player => player.bd?.acc?.meleeHits ?? 0,
        minValue: 3,
        format: value => `${value} MELEE HITS`,
    },
    {
        key: 'CROWD_CONTROL',
        weight: 2,
        label: 'LA.award.CROWD_CONTROL.label',
        icon: 'fa-users',
        description: 'LA.award.CROWD_CONTROL.description',
        stat: player => player.maxTargetsOneRound ?? 0,
        minValue: 3,
        format: value => `${value} IN ONE ROUND`,
    },
    {
        key: 'LIGHTNING_ROD',
        weight: 1,
        label: 'LA.award.LIGHTNING_ROD.label',
        icon: 'fa-magnet',
        description: 'LA.award.LIGHTNING_ROD.description',
        stat: player => (player.bd?.dmgIn?.attacksTaken ?? 0) + (player.bd?.dmgIn?.techTaken ?? 0),
        minValue: 5,
        format: value => `${value} ATTACKS DRAWN`,
    },
    {
        key: 'REFLEX',
        weight: 1,
        label: 'LA.award.REFLEX.label',
        icon: 'fa-stopwatch',
        description: 'LA.award.REFLEX.description',
        stat: player => player.reactionsUsed ?? 0,
        minValue: 2,
        format: value => `${value} REACTIONS`,
    },
    {
        key: 'RECON',
        weight: 1,
        label: 'LA.award.RECON.label',
        icon: 'fa-satellite-dish',
        description: 'LA.award.RECON.description',
        stat: player => player.scans ?? 0,
        minValue: 2,
        format: value => `${value} SCANS`,
    },
    {
        key: 'ARSONIST',
        weight: 1,
        label: 'LA.award.ARSONIST.label',
        icon: 'fa-fire',
        description: 'LA.award.ARSONIST.description',
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
        label: 'LA.award.COOL_HEAD.label',
        icon: 'fa-fan',
        description: 'LA.award.COOL_HEAD.description',
        stat: player => player.heatCooled ?? 0,
        minValue: 6,
        format: value => `${value} HEAT VENTED`,
    },
    {
        key: 'GREASE_MONKEY',
        weight: 1,
        label: 'LA.award.GREASE_MONKEY.label',
        icon: 'fa-wrench',
        description: 'LA.award.GREASE_MONKEY.description',
        stat: player => player.hpRestored ?? 0,
        minValue: 5,
        format: value => `${value} HP RECOVERED`,
    },
];
