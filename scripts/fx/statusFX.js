/**
 * StatusFX: TokenMagic visual effects for Lancer statuses
 */
/*global TokenMagic */

import { getIsoProvider } from '../setup/iso-settings.js';
import { isAdditionalStatusUnavailable } from '../setup/status-effects.js';

import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { localize } from '../tools/string-utils.js';
import { getLAFlags } from '../tools/flag-utils.js';
import * as customFilterClasses from '../filters/customFilters.js';
import { isDangerZoneHeat, VALUE_STATUS_PATHS } from '../utils/lancer-token.js';
const SETTING_FX_CONFIG = 'statusFXConfig';

// Effect definitions

const FX_DEFAULTS = {
    // Master toggle
    master: true,
    // Swap heavy bloom/glow presets for outline-only variants.
    lowQuality: false,
    legacyBurnInfection: false,
    // TokenMagic visual effects
    fx_dangerZone:  true,
    fx_burn:        true,
    fx_overshield:  true,
    fx_cascading:   true,
    fx_invisible:   true,
    fx_hidden:      true,
    fx_brace:       true,
    fx_jammed:      true,
    fx_intangible:  true,
    fx_infection:   true,
    fx_exposed:     true,
    fx_falling:     true,
    fx_dazed:       true,
    fx_stunned:     true,
    fx_impaired:    true,
    fx_vulnerable:  true,
    fx_lockOn:      true,
    fx_aided:       true,
    fx_resistAll:   true,
    fx_phasing:     true,
    fx_overheated:  true,
    fx_reactorMeltdown: true,
    fx_shredded:    true,
    fx_prone:       true,
    fx_slowed:      true,
    fx_bolstered:   true,
    fx_shutDown:    true,
    fx_disengage:   true,
    fx_throttled:   true,
    fx_immobilized:   true,
    fx_blinded:     true,
    fx_flying:      true,
    fx_corePower:   true,
    // Auto-status toggles
    auto_dangerZone:  true,
    auto_burn:        true,
    auto_overshield:  true,
    auto_infection:   true,
    auto_cascading:   true,
    // Action FX (Boost, Hide, Shut Down, Fall, Overcharge, etc.)
    actionFX:         false,
    // Miss / crit overlays on attacks, success / fail pulses on stat rolls
    rollResultFX:     true,
    // Damage-type impacts on the target
    damageImpactFX:   true,
    reactorExplosionFX: true,
};

export const STATUS_FX_KEYS = [
    'dangerZone', 'burn', 'overshield', 'cascading', 'invisible', 'hidden', 'brace', 'jammed',
    'intangible', 'infection', 'exposed', 'falling', 'dazed', 'stunned', 'impaired', 'vulnerable',
    'lockOn', 'aided', 'resistAll', 'phasing', 'overheated', 'reactorMeltdown', 'shredded', 'prone',
    'slowed', 'bolstered', 'shutDown', 'disengage', 'throttled', 'immobilized', 'blinded', 'flying',
    'corePower',
];

function getConfig()
{
    const stored = getModuleSetting(SETTING_FX_CONFIG);
    return { ...FX_DEFAULTS, ...stored };
}

export function isActionFXEnabled()
{
    try
    {
        return getConfig().actionFX !== false;
    }
    catch
    {
        return true;
    }
}

export function isRollResultFXEnabled()
{
    try
    {
        return getConfig().rollResultFX !== false;
    }
    catch
    {
        return true;
    }
}

export function isDamageImpactFXEnabled()
{
    try
    {
        return getConfig().damageImpactFX !== false;
    }
    catch
    {
        return true;
    }
}

export function isReactorExplosionFXEnabled()
{
    try
    {
        return getConfig().reactorExplosionFX !== false;
    }
    catch
    {
        return true;
    }
}

function isMasterEnabled()
{
    try
    {
        return getConfig().master;
    }
    catch
    {
        return false;
    }
}

function isFXEnabled(key)
{
    if (!isMasterEnabled())
        return false;
    return getConfig()[`fx_${key}`] ?? false;
}

export function isAutoEnabled(key)
{
    if (!isMasterEnabled())
        return false;
    return getConfig()[`auto_${key}`] ?? false;
}

// Settings registration

export function registerStatusFXSettings()
{
    // Hidden config store (full config object including master toggle)
    game.settings.register(MODULE_ID, SETTING_FX_CONFIG, {
        scope: 'world',
        config: false,
        type: Object,
        default: { ...FX_DEFAULTS },
        requiresReload: true,
    });

}

// TokenMagic Effect Definitions

const dangerZoneEffect = [
    {
        filterType: "ventColumn",
        filterId: "DangerZoneVent",
        hotColor: 0xff8442,
        plumeColor: 0xfeb76c,
        warpFreq: 16,
        warpAmp: 0.012,
        riseSpeed: 1.4,
        reach: 0.07,
        plumeFreq: 17,
        plumeStrength: 1.2,
        bodyGlow: 0.55,
        opacity: 1.0,
        padding: 24,
        timeSpeed: 1.0
    }
];

const overheatedChurn = {
    filterType: "convectionChurn",
    filterId: "OverheatedChurn",
    hotColor: 0xff8a1e,
    coolColor: 0x4a2a1c,
    rimColor: 0xffc06a,
    churnScale: 4,
    rise: 0.35,
    warpAmp: 0.035,
    mixAmt: 0.38,
    rimWidth: 0.008,
    rimGlow: 0,
    opacity: 1.0,
    timeSpeed: 1.0
};

const overheatedEffect = [
    overheatedChurn,
    {
        filterType: "glow",
        filterId: "OverheatedGlow",
        outerStrength: 3,
        innerStrength: 1.5,
        color: 0xff9633,
        quality: 0.5,
        padding: 10,
        animated: {
            color: { active: true, loopDuration: 6000, animType: "colorOscillation", val1: 0xEE5500, val2: 0xff9633 },
            outerStrength: { active: true, loopDuration: 6000, animType: "cosOscillation", val1: 1.5, val2: 2.5 }
        }
    },
    {
        filterType: "xbloom",
        filterId: "OverheatedBloom",
        threshold: 0.35,
        bloomScale: 0,
        brightness: 1,
        blur: 0.1,
        padding: 10,
        quality: 4,
        blendMode: 0,
        animated: { bloomScale: { active: true, loopDuration: 6000, animType: "sinOscillation", val1: 0.4, val2: 1.0 } }
    }
];

const enkiduOverheatedEffect = [
    overheatedChurn,
    {
        filterType: "glow",
        filterId: "OverheatedGlow",
        outerStrength: 3,
        innerStrength: 1.5,
        color: 0x9c24f2,
        quality: 0.5,
        padding: 10,
        animated: {
            color: { active: true, loopDuration: 6000, animType: "colorOscillation", val1: 0xf224cc, val2: 0x9c24f2 },
            outerStrength: { active: true, loopDuration: 6000, animType: "cosOscillation", val1: 1.5, val2: 2.5 }
        }
    },
    // Matched by filterId, never by position, so reordering the chain above cannot swap it out.
    overheatedEffect.find(filter => filter.filterId === "OverheatedBloom")
];

const burnEffect = [
    {
        filterType: "xglow",
        filterId: "BurnGlow",
        auraType: 2,
        color: 0x903010,
        thickness: 9.8,
        scale: 4,
        time: 0,
        auraIntensity: 2,
        subAuraIntensity: 1.5,
        threshold: 0.40,
        discard: true,
        animated: {
            time: { active: true, speed: 0.0027, animType: "move" },
            thickness: { active: true, loopDuration: 3000, animType: "cosOscillation", val1: 2, val2: 5 }
        }
    }
];

const burnFlamesEffect = [
    {
        filterType: "toonFlames",
        filterId: "BurnFlames",
        stack: 7,
        reach: 0.1,
        thickness: 1,
        scale: 14,
        speed: 1.5,
        sway: 0.2,
        fall: 1.0,
        baseCut: 0.3,
        gapLo: 0.15,
        gapSoft: 0.2,
        hullLick: 0.15,
        inkWidth: 0,
        light: 0.4,
        lightReach: 0.015,
        deep: 0xb3200a,
        mid: 0xff5a14,
        core: 0xffd34d,
        ink: 0x1c0904,
        opacity: 1.0,
        padding: 36,
        timeSpeed: 1.0
    }
];

const overshieldEffect = [
    {
        filterType: "doubleShell",
        filterId: "OverShieldShell",
        innerColor: 0xcdf2ff,
        outerColor: 0x49c9f0,
        bloomColor: 0x2f8fd8,
        pulsePeriod: 2.0,
        gapMin: 0.018,
        gapMax: 0.01,
        innerWidth: 0.004,
        outerWidth: 0.004,
        innerStrength: 0.0,
        outerStrength: 0.6,
        bloomWidth: 0.01,
        bloom: 0.7,
        opacity: 1.0,
        padding: 24,
        timeSpeed: 1.0
    }
];

const cascadingEffect = [
    {
        filterType: "sliceTear",
        filterId: "CascadingTear",
        tickRate: 15,
        burstRate: 1.2,
        burstChance: 0.05,
        bands: 22,
        tear: 0.12,
        tearChance: 0.3,
        split: 0.015,
        splitWobble: 0.3,
        splitSpeed: 0.4,
        splitSway: 0.35,
        blockGrid: 19,
        blockChance: 0.04,
        scan: 0.25,
        glitchA: 0x9422b4,
        glitchB: 0x9bff3a,
        opacity: 1.0,
        padding: 24,
        timeSpeed: 1.0
    }
];

const invisibleEffect = [
    {
        filterType: "liquid",
        filterId: "invisible",
        color: 0x20AAEE,
        time: 0,
        blend: 8,
        intensity: 4,
        spectral: true,
        scale: 0.9,
        animated: {
            time: { active: true, speed: 0.0010, animType: "move" },
            color: { active: true, loopDuration: 6000, animType: "colorOscillation", val1: 0xFFFFFF, val2: 0x00AAFF }
        }
    }
];

const hiddenEffect = [
    {
        filterType: "fog",
        filterId: "hidden",
        color: 0x000000,
        density: 0.4,
        time: 0,
        dimX: 1,
        dimY: 1,
        animated: { time: { active: true, speed: 2.2, animType: "move" } }
    }
];

const braceEffect = [
    {
        filterType: "field",
        filterId: "brace",
        shieldType: 4,
        gridPadding: 2,
        color: 0xf0ae89,
        time: 0,
        blend: 1,
        intensity: 1.25,
        lightAlpha: 1,
        lightSize: 1,
        scale: 1,
        radius: 0.4,
        chromatic: false,
        animated: { time: { active: true, speed: 0.0015, animType: "move" } }
    }
];

const jammedEffect = [
    {
        filterType: "signalCut",
        filterId: "JammedSignalCut",
        charSize: 0.028,
        bandW: 0.02,
        blocks: 6,
        fill: 0.5,
        speed: 1.2,
        plate: 0.85,
        rimW: 0.01,
        rimAlpha: 0.36,
        period: 3.9,
        spikeLen: 0.13,
        bands: 26,
        tear: 0.03,
        split: 0.006,
        tint: 0.45,
        codeColor: 0x8affeb,
        headColor: 0xdde6ff,
        plateColor: 0x0c235a,
        opacity: 0.64,
        padding: 12,
        timeSpeed: 1.0
    }
];

const intangibleEffect = [
    {
        filterType: "distortion",
        filterId: "intangible1",
        maskPath: "modules/tokenmagic/fx/assets/distortion-1.png",
        maskSpriteScaleX: 5,
        maskSpriteScaleY: 5,
        padding: 20,
        animated: {
            maskSpriteX: { active: true, speed: 0.05, animType: "move" },
            maskSpriteY: { active: true, speed: 0.07, animType: "move" }
        }
    },
    {
        filterType: "adjustment",
        filterId: "intangible2",
        saturation: 1,
        brightness: 1,
        contrast: 1,
        gamma: 1,
        red: 0.2,
        green: 0.2,
        blue: 0.2,
        alpha: 1,
        animated: { alpha: { active: true, loopDuration: 4000, animType: "syncCosOscillation", val1: 0.35, val2: 2.75 } }
    },
    {
        filterType: "glow",
        filterId: "intangible3",
        padding: 10,
        color: 0x666666,
        thickness: 0.1,
        quality: 5,
        zOrder: 9,
        animated: { thickness: { active: true, loopDuration: 4000, animType: "syncCosOscillation", val1: 6, val2: 0 } }
    }
];

const exposedEffect = [
    {
        filterType: "heatPurge",
        filterId: "ExposedHeatPurge",
        period: 6.6,
        strength: 1.63,
        heat: 0.8,
        shards: 11,
        spread: 0.86,
        outline: 0.26,
        opacity: 1,
        padding: 12,
        timeSpeed: 1
    }
];

const infectionEffect = [
    {
        filterType: "xglow",
        filterId: "InfectionGlow",
        auraType: 2,
        color: 0x109030,
        thickness: 9.8,
        scale: 4,
        time: 0,
        auraIntensity: 2,
        subAuraIntensity: 1.5,
        threshold: 0.40,
        discard: true,
        animated: {
            time: { active: true, speed: 0.0027, animType: "move" },
            thickness: { active: true, loopDuration: 3000, animType: "cosOscillation", val1: 2, val2: 5 }
        }
    }
];

const infectionBleedEffect = [
    {
        filterType: "dataBleed",
        filterId: "InfectionBleed",
        stack: 1,
        reach: 0.075,
        upBias: 0.68,
        cols: 21,
        rise: 0.2,
        density: 0.31,
        gapLo: 0.15,
        gapSoft: 0.2,
        bandW: 0.035,
        blockSize: 0.01,
        amount: 0.65,
        tickRate: 6,
        rimWidth: 0.000,
        light: 0.4,
        lightReach: 0.03,
        codeColor: 0x4dff3a,
        headColor: 0xeaffd8,
        backColor: 0x04210a,
        opacity: 1,
        padding: 16,
        timeSpeed: 1.0
    }
];

const fallingEffect = [
    {
        filterType: "smoke",
        filterId: "FallingSmoke",
        color: 0x99aacc,
        time: 0,
        blend: 2,
        dimX: 1,
        dimY: 0.1,
        animated: {
            time: { active: true, speed: 0.01, animType: "move" },
            dimY: { active: true, val1: 0.05, val2: 0.15, animType: "cosOscillation", loopDuration: 4000 }
        }
    }
];

const dazedEffect = [
    {
        filterType: "filmEcho",
        filterId: "DazedFilmEcho",
        tone: 0.46,
        grain: 0.27,
        grainSize: 220,
        weave: 0,
        scratches: 0.8,
        flicker: 0.11,
        vignette: 0.45,
        radius: 0.035,
        speed: 1.6,
        echoes: 3,
        fade: 0.55,
        tintMix: 0.45,
        sepiaColor: 0xd9b26a,
        tintEcho: 0xffd27a,
        opacity: 1.0,
        padding: 8,
        timeSpeed: 1.0
    }
];

const stunnedEffect = [
    {
        filterType: "teslaTremor",
        filterId: "StunnedTesla",
        tremor: 0.004,
        rate: 14,
        burstPeriod: 3.3,
        burstLen: 0.3,
        sparks: 1,
        arcs: 16,
        reach: 0.075,
        drift: 0.55,
        jag: 0.011,
        bend: 0.56,
        boltWidth: 0.008,
        flicker: 19.5,
        rim: 0.5,
        hot: 1,
        ink: 0.45,
        idle: 0.8,
        idleChance: 0.2,
        idleReach: 0.6,
        idleRate: 6,
        boltColor: 0xf2fdff,
        glowColor: 0x6188ff,
        inkColor: 0x031820,
        opacity: 1.0,
        padding: 20,
        timeSpeed: 1.0
    }
];

const impairedEffect = [
    {
        filterType: "chromaRotPlus",
        filterId: "ImpairedRotPlus",
        rotColor: 0xb8bcc2,
        blocks: 28,
        drift: 0.08,
        levels: 4,
        strength: 0.43,
        dropThreshold: 0.5,
        edgeRot: 0.6,
        coreRot: 0.08,
        depth: 0.1,
        flakes: 0.3,
        shed: 0.08,
        stepRate: 5,
        opacity: 0.9,
        padding: 8,
        timeSpeed: 1.0
    }
];

const lockOnEffect = [
    {
        filterType: "trackingGhost",
        filterId: "LockOnGhost",
        colorHot: 0xff4422,
        colorCold: 0x22d8ff,
        lockAngle: 0,
        spinRate: 1.5,
        ghostDist: 0.065,
        lockPeriod: 1.4,
        steps: 10,
        ghostOpacity: 0.35,
        ringWidth: 0.002,
        chirpStrength: 0.0,
        opacity: 1.0,
        padding: 24,
        timeSpeed: 1.0
    }
];

const vulnerableEffect = [
    {
        filterType: "thermalScan",
        filterId: "VulnerableThermalScan",
        period: 3.2,
        tilt: 180,
        bandWidth: 0.15,
        linger: 0.31,
        strength: 1,
        depth: 0.106,
        grain: 1.21,
        opacity: 1,
        timeSpeed: 1
    }
];

const aidedEffect = [
    {
        filterType: "guidingLight",
        filterId: "AidedGleam",
        aidColor: 0xa9f0c6,
        bearing: 150,
        rimWidth: 0.02,
        sweepPeriod: 2.6,
        gleamWidth: 0.22,
        keyLight: 0.85,
        gleamGain: 1.55,
        rimStrength: 0.45,
        opacity: 1.0,
        padding: 10,
        timeSpeed: 1.0
    }
];

const proneEffect = [
    {
        filterType: "noDrift",
        filterId: "ProneNoDriftSnap",
        ghostColor: 0x34465a,
        snapColor: 0xffffff,
        inkColor: 0x0b1016,
        bearing: 180,
        tryPeriod: 3.4,
        slip: 0.03,
        ghostStrength: 0.5,
        holdStrength: 0.15,
        snapStrength: 0.9,
        inkStrength: 0.75,
        inkHold: 0,
        inkW: 0.011,
        opacity: 1.0,
        padding: 16,
        timeSpeed: 1.0
    }
];

const phasingEffect = [
    {
        filterType: "slicePlane",
        filterId: "PhasingSlice",
        edgeColor: 0xa06cff,
        cutAngle: 25,
        slide: 0.01,
        rate: 0.35,
        bounce: 0,
        travel: 0.9,
        opacity: 1.0,
        padding: 16,
        timeSpeed: 1.0
    }
];

const resistAllEffect = [
    {
        filterType: "crackShell",
        filterId: "ResistAllShell",
        reach: 0.09,
        gap: 0.007,
        thick: 0.02,
        cells: 14,
        shellA: 0.32,
        crackW: 0.006,
        period: 3.6,
        breakChance: 0.15,
        liftMax: 0.025,
        flicker: 0.5,
        shimmer: 0.8,
        glowAmt: 0.7,
        glowR: 0.014,
        ink: 0.5,
        shellColor: 0xcfdff0,
        coreColor: 0xffffff,
        inkColor: 0x0e1620,
        opacity: 1,
        padding: 24,
        timeSpeed: 1
    }
];

const reactorMeltdownEffect = [
    {
        filterType: "seamBeat",
        filterId: "MeltdownSeams",
        seamColor: 0xff2d3c,
        seamCore: 0xffb0a0,
        rimColor: 0xff3a2a,
        blocks: 9,
        setPeriod: 4.9,
        beats: 2,
        gapMin: 0.0,
        gapMax: 0.3,
        seamStrength: 1.0,
        coreStrength: 0.8,
        rimWidth: 0.016,
        rimBase: 0.15,
        rimKick: 1.1,
        glow: 0.9,
        opacity: 1.0,
        padding: 24,
        timeSpeed: 1.0
    }
];

const shreddedEffect = [
    {
        filterType: "grindSparks",
        filterId: "ShreddedGrindSparks",
        reach: 0.074,
        fallReach: 0.02,
        cols: 23,
        rows: 15,
        fallSpeed: 0.55,
        density: 0.42,
        slant: 0.3,
        sparkW: 0.0022,
        rimW: 0.012,
        rimScale: 30,
        rimSpeed: 1.2,
        rimHeat: 1,
        light: 0.45,
        lightReach: 0.03,
        poolR: 0.03,
        poolAmt: 0.8,
        points: 4,
        drift: 0.07,
        burst: 1.7,
        duty: 0.7,
        sparks: 12,
        sparkLife: 0.3,
        sparkSpeed: 0.45,
        spread: 1,
        lift: 0.6,
        gravity: 1.4,
        streak: 0.06,
        sprayW: 0.003,
        spotR: 0.016,
        deep: 0x9a1f06,
        mid: 0xff8a2a,
        core: 0xfff4c8,
        opacity: 1,
        padding: 40,
        timeSpeed: 1
    }
];

const strippedEffect = [
    {
        filterType: "cutTorch",
        filterId: "StrippedCutTorch",
        heads: 3,
        samples: 10,
        speed: 0.06,
        spacing: 0.016,
        jump: 0.07,
        cutW: 0.007,
        cutReach: 0.013,
        headR: 0.007,
        glowR: 0.016,
        glowAmt: 0.8,
        lineW: 1.2,
        edgeLo: 0.16,
        edgeHi: 0.42,
        seamR: 0.04,
        seamAmt: 0.85,
        scorchAmt: 0.3,
        light: 0.6,
        lightR: 0.05,
        sparks: 7,
        sparkLife: 0.4,
        sparkSpeed: 0.3,
        spread: 1.4,
        gravity: 1.4,
        streak: 0.035,
        sparkW: 0.002,
        dropGap: 0.14,
        dropLife: 0.7,
        dropKick: 0.04,
        dropR: 0.0045,
        dropChance: 0.6,
        flareR: 0.02,
        deep: 0x3a4c5c,
        mid: 0x309acf,
        core: 0xffffff,
        opacity: 1,
        padding: 40,
        timeSpeed: 1
    }
];

const slowedEffect = [
    {
        filterType: "overflowWrap",
        filterId: "SlowedBands",
        lineColor: 0x9e9e9e,
        period: 1.1,
        lines: 8,
        thickness: 0.596,
        opacity: 1.0,
        timeSpeed: 1.0
    }
];

const disengageEffect = [
    {
        filterType: "ricochetLip",
        filterId: "DisengageRounds",
        roundColor: 0xffd9a0,
        sparkColor: 0xfff0c0,
        lipColor: 0x9aa3ae,
        bearing: 215,
        lanes: 24,
        laneTight: 6,
        flightPeriod: 2.9,
        trailLen: 0.23,
        hardness: 0,
        throughFloor: 0.66,
        lipWidth: 0.004,
        onSprite: 1,
        bodyFade: 0.44,
        confine: 1,
        roundStrength: 1,
        sparkStrength: 1.1,
        lipStrength: 0.3,
        opacity: 1.0,
        padding: 16,
        timeSpeed: 1.0
    }
];

const shutDownEffect = [
    {
        filterType: "coldSoak",
        filterId: "ShutDownSoak",
        coldColor: 0x38414d,
        frostColor: 0x9fc4d8,
        frontPeriod: 6,
        depth: 0.86,
        opacity: 1.0,
        timeSpeed: 1.0
    }
];

const bolsteredEffect = [
    {
        filterType: "errorCorrection",
        filterId: "BolsteredBand",
        bandColor: 0x7fe8ff,
        bandWidth: 0.09,
        period: 2.7,
        boost: 0,
        opacity: 1.0,
        timeSpeed: 1.0
    }
];

const throttledEffect = [
    {
        filterType: "fracture",
        filterId: "ThrottledCracks",
        color: 0xe08c26,
        intensity: 3.0,
        scale: 6,
        crackWidth: 0.04,
        opacity: 0.8,
        warpStrength: 1.0,
        noiseScale: 5.0,
        maskAmount: 0.3,
        blend: 2,
        timeSpeed: 0.6
    },
    {
        filterType: "glow",
        filterId: "ThrottledGlow",
        outerStrength: 1,
        innerStrength: 0,
        color: 0xe08c26,
        quality: 0.5,
        padding: 10,
        animated: {
            outerStrength: { active: true, loopDuration: 3000, animType: "cosOscillation", val1: 0.5, val2: 1 }
        }
    },
    {
        filterType: "adjustment",
        filterId: "ThrottledAdjust",
        saturation: 1.1,
        brightness: 1,
        contrast: 1,
        red: 1.2,
        green: 1.0,
        blue: 0.65,
        animated: {
            brightness: { active: true, loopDuration: 2000, animType: "syncCosOscillation", val1: 0.9, val2: 1.15 }
        }
    }
];

const immobilizedEffect = [
    {
        filterType: "chainSets",
        filterId: "ImmobilizedChainSets",
        sets: 2,
        spacing: 0.185,
        pitch: 0.025,
        speed: 0.06,
        lineWidth: 0.002,
        glowWidth: 0.016,
        glow: 0.7,
        intensity: 1.32,
        halo: 1,
        sway: 0.007,
        speedVar: 0.7,
        stutter: 0.75,
        pullPeriod: 2.15,
        fade: 0.55,
        color: 0xccaa66,
        opacity: 0.73,
        padding: 12,
        timeSpeed: 1.0
    }
];

const staggeredEffect = [
    {
        filterType: "recoil",
        filterId: "StaggeredRecoil",
        period: 1.6,
        recoil: 0.005,
        streaks: 1.07,
        reach: 0.108,
        flash: 1.16,
        hitColor: 0x9944cc,
        coreColor: 0xe9d6ff,
        opacity: 1.0,
        padding: 24,
        timeSpeed: 1.0
    }
];

const blindedEffect = [
    {
        filterType: "outOfFocus",
        filterId: "BlindedFocus",
        minBlur: 0.004,
        maxBlur: 0.02,
        period: 4.5,
        haze: 0.35,
        hazeColor: 0xdfe6f0,
        opacity: 1.0,
        padding: 8,
        timeSpeed: 1.0
    }
];

const flyingEffect = [
    {
        filterType: "transform",
        filterId: "FlyingBob",
        padding: 0,
        translationY: 0,
        animated: {
            translationY: {
                animType: "cosOscillation",
                val1: 0,
                val2: 0.03,
                loopDuration: 2000
            }
        }
    }
];

const flyingEffectIso = [
    {
        filterType: "transform",
        filterId: "FlyingBob",
        padding: 0,
        translationX: 0,
        translationY: 0,
        animated: {
            translationX: {
                animType: "cosOscillation",
                val1: 0,
                val2: -0.0355,
                loopDuration: 2000
            },
            translationY: {
                animType: "cosOscillation",
                val1: 0,
                val2: 0.0212,
                loopDuration: 2000
            }
        }
    }
];

const corePowerEffect = [
    {
        filterType: "xbloom",
        filterId: "CorePowerBloom",
        threshold: 0.35,
        bloomScale: 0,
        brightness: 1,
        blur: 0.1,
        padding: 10,
        quality: 4,
        blendMode: 0,
        animated: {
            bloomScale: {
                active: true,
                loopDuration: 3500,
                animType: "syncCosOscillation",
                val1: 0,
                val2: 2.1
            }
        }
    }
];

// Low-quality variants
// outline-only swaps for bloom/glow presets; filter IDs kept identical for EFFECT_MAP matching

const overheatedEffectLite = [
    {
        filterType: "outline",
        filterId: "OverheatedGlow",
        color: 0xff9633,
        thickness: 2,
        quality: 3,
        padding: 4,
        animated: {
            color: { active: true, loopDuration: 6000, animType: "colorOscillation", val1: 0xEE5500, val2: 0xff9633 },
            thickness: { active: true, loopDuration: 6000, animType: "cosOscillation", val1: 1.5, val2: 3 }
        }
    }
];

const enkiduOverheatedEffectLite = [
    {
        filterType: "outline",
        filterId: "OverheatedGlow",
        color: 0x9c24f2,
        thickness: 2,
        quality: 3,
        padding: 4,
        animated: {
            color: { active: true, loopDuration: 6000, animType: "colorOscillation", val1: 0xf224cc, val2: 0x9c24f2 },
            thickness: { active: true, loopDuration: 6000, animType: "cosOscillation", val1: 1.5, val2: 3 }
        }
    }
];

const corePowerEffectLite = [
    {
        filterType: "outline",
        filterId: "CorePowerBloom",
        color: 0xffe080,
        thickness: 2.5,
        quality: 3,
        padding: 4,
        animated: { thickness: { active: true, loopDuration: 3500, animType: "syncCosOscillation", val1: 1, val2: 3 } }
    }
];

const LOW_QUALITY_PRESETS = {
    overheated: overheatedEffectLite,
    corePower: corePowerEffectLite,
};

// Effect Map

// staleFilterIds are cleaned up but never added, so a dropped filter is not orphaned on old tokens.
const allFilterIds = entry => entry.staleFilterIds ? [...entry.filterIds, ...entry.staleFilterIds] : entry.filterIds;

function resolveEntry(entry)
{
    if (!entry.legacy || !getConfig().legacyBurnInfection)
        return entry;
    const stale = [...entry.filterIds, ...(entry.staleFilterIds ?? [])].filter(filterId => !entry.legacy.filterIds.includes(filterId));
    return { ...entry, preset: entry.legacy.preset, filterIds: entry.legacy.filterIds, staleFilterIds: stale };
}

const EFFECT_MAP = [
    { name: 'Danger Zone', key: 'dangerZone', preset: dangerZoneEffect, filterIds: ['DangerZoneVent'], staleFilterIds: ['DangerZoneGlow', 'DangerZoneBloom'] },
    { name: 'Burn',        key: 'burn',       preset: burnFlamesEffect, filterIds: ['BurnFlames'], staleFilterIds: ['BurnGlow'], legacy: { preset: burnEffect, filterIds: ['BurnGlow'] } },
    { name: 'Overshield',  key: 'overshield', preset: overshieldEffect, filterIds: ['OverShieldShell'], staleFilterIds: ['OverShieldGlow'] },
    { name: 'Cascading',   key: 'cascading',  preset: cascadingEffect,  filterIds: ['CascadingTear'], staleFilterIds: ['cascading1', 'cascading2'] },
    { name: 'Invisible',   key: 'invisible',  preset: invisibleEffect,  filterIds: ['invisible'] },
    { name: 'Hidden',      key: 'hidden',     preset: hiddenEffect,     filterIds: ['hidden'] },
    { name: 'Brace',       key: 'brace',      preset: braceEffect,      filterIds: ['brace'] },
    { name: 'Jammed',      key: 'jammed',     preset: jammedEffect,     filterIds: ['JammedSignalCut'], staleFilterIds: ['jammedShadow', 'jammedElectric'] },
    { name: 'Intangible',  key: 'intangible', preset: intangibleEffect, filterIds: ['intangible1', 'intangible2', 'intangible3'] },
    { name: 'Infection',   key: 'infection',  preset: infectionBleedEffect, filterIds: ['InfectionBleed'], staleFilterIds: ['InfectionGlow', 'InfectionSwarm', 'InfectionFever', 'InfectionCode'], legacy: { preset: infectionEffect, filterIds: ['InfectionGlow'] } },
    { name: 'Exposed',    key: 'exposed',   preset: exposedEffect,   filterIds: ['ExposedHeatPurge'], staleFilterIds: ['ExposedForgeSeams', 'ExposedShatter', 'ExposedGlow', 'ExposedAdjust', 'ExposedDistortion', 'ExposedCracks', 'ExposedOutline', 'ExposedSeams'] },
    { name: 'Falling',    key: 'falling',   preset: fallingEffect,   filterIds: ['FallingSmoke'] },
    { name: 'Dazed',      key: 'dazed',     preset: dazedEffect,     filterIds: ['DazedFilmEcho'], staleFilterIds: ['DazedFilm', 'DazedOutline'] },
    { name: 'Stunned',    key: 'stunned',   preset: stunnedEffect,   filterIds: ['StunnedTesla'], staleFilterIds: ['StunnedFilm', 'StunnedOutline', 'StunnedElectric'] },
    { name: 'Impaired',   key: 'impaired',  preset: impairedEffect,  filterIds: ['ImpairedRotPlus'], staleFilterIds: ['ImpairedRot'] },
    { name: 'Vulnerable', key: 'vulnerable', preset: vulnerableEffect, filterIds: ['VulnerableThermalScan'], staleFilterIds: ['VulnerableDistortion', 'VulnerableCracks', 'VulnerableOutline', 'VulnerableShatter', 'VulnerableGlow', 'VulnerableAdjust', 'VulnerableSeams'] },
    { name: 'Lock On',    key: 'lockOn',     preset: lockOnEffect,     filterIds: ['LockOnGhost'] },
    { name: 'Aided',      key: 'aided',      preset: aidedEffect,      filterIds: ['AidedGleam'] },
    { name: 'Resist All', key: 'resistAll',  preset: resistAllEffect,  filterIds: ['ResistAllShell'], staleFilterIds: ['ResistAllCrust'] },
    { name: 'Phasing',    key: 'phasing',    preset: phasingEffect,    filterIds: ['PhasingSlice'] },
    { name: 'Overheated', key: 'overheated', preset: overheatedEffect, filterIds: ['OverheatedChurn', 'OverheatedGlow', 'OverheatedBloom'], staleFilterIds: ['OverheatedWave', 'OverheatedCracks'] },
    { name: 'Reactor Meltdown', key: 'reactorMeltdown', preset: reactorMeltdownEffect, filterIds: ['MeltdownSeams'] },
    { name: 'Shredded',   key: 'shredded',  preset: shreddedEffect,  filterIds: ['ShreddedGrindSparks'], staleFilterIds: ['ShreddedPlatingDrip', 'ShreddedShedPlates', 'ShreddedShatter', 'ShreddedGlow', 'ShreddedAdjust', 'ShreddedCracks'] },
    { name: 'Stripped',   key: 'shredded',  preset: strippedEffect,  filterIds: ['StrippedCutTorch'], staleFilterIds: ['StrippedPlatingDrip', 'StrippedShatter', 'StrippedGlow', 'StrippedAdjust', 'StrippedCracks'] },
    { name: 'Prone',      key: 'prone',     preset: proneEffect,     filterIds: ['ProneNoDriftSnap'], staleFilterIds: ['ProneNoDriftInk', 'ProneNoDrift', 'ProneWave', 'ProneGlow'] },
    { name: 'Slowed',     key: 'slowed',    preset: slowedEffect,    filterIds: ['SlowedBands'], staleFilterIds: ['SlowedWave', 'SlowedGlow'] },
    { name: 'Bolster',    key: 'bolstered', preset: bolsteredEffect, filterIds: ['BolsteredBand'] },
    { name: 'Shut Down',  key: 'shutDown',  preset: shutDownEffect,  filterIds: ['ShutDownSoak'] },
    { name: 'Disengage',  key: 'disengage', preset: disengageEffect, filterIds: ['DisengageRounds'] },
    { name: 'Throttled',  key: 'throttled', preset: throttledEffect, filterIds: ['ThrottledCracks', 'ThrottledGlow', 'ThrottledAdjust'] },
    { name: 'Immobilized', key: 'immobilized', preset: immobilizedEffect, filterIds: ['ImmobilizedChainSets'], staleFilterIds: ['ImmobilizedChains', 'ImmobilizedGlow'] },
    { name: 'Staggered',   key: 'immobilized', preset: staggeredEffect, filterIds: ['StaggeredRecoil'], staleFilterIds: ['StaggeredReeling', 'StaggeredChainSets', 'StaggeredChains', 'StaggeredGlow'] },
    { name: 'Blinded',    key: 'blinded',     preset: blindedEffect,   filterIds: ['BlindedFocus'], staleFilterIds: ['BlindedCRT', 'BlindedAdjust'] },
    { name: 'Flying',    key: 'flying',      preset: flyingEffect,    filterIds: ['FlyingBob'] },
    { name: 'Hover',     key: 'flying',      preset: flyingEffect.map(filter => ({ ...filter, filterId: filter.filterId.replace('Flying', 'Hover') })), filterIds: ['HoverBob'] },
    { name: 'Core Power Active', key: 'corePower', preset: corePowerEffect, filterIds: ['CorePowerBloom'] },
];

// Apply / Remove FX

/** Check if actor has the Enkidu alt frame (Tokugawa alt). */
function isEnkiduFrame(actor)
{
    return actor?.items?.filter(item => item.system?.lid === 'mf_tokugawa_alt_enkidu').length > 0;
}

// Auto-status logic

async function autoStatusDangerZone(actor)
{
    if (!isAutoEnabled('dangerZone'))
        return;

    const heat = actor.system?.heat;
    if (!heat)
        return;
    await actor.toggleStatusEffect('dangerzone', { active: isDangerZoneHeat(heat.value, heat.max) });
}

async function autoStatusBurn(actor)
{
    if (!isAutoEnabled('burn'))
        return;

    const burn = actor.system?.burn;
    if (burn == null)
        return;
    await actor.toggleStatusEffect('burn', { active: burn > 0 });
}

async function autoStatusOvershield(actor)
{
    if (!isAutoEnabled('overshield'))
        return;

    const overshield = actor.system?.overshield?.value;
    if (overshield == null)
        return;
    await actor.toggleStatusEffect('overshield', { active: overshield > 0 });
}

async function autoStatusInfection(actor)
{
    if (!isAutoEnabled('infection'))
        return;

    const infection = actor.system?.infection ?? 0;
    await actor.toggleStatusEffect('infection', { active: infection > 0 });
}

async function autoStatusCascading(actor)
{
    if (!isAutoEnabled('cascading'))
        return;

    const hasCascading = actor.items?.some?.(item => item.system?.cascading === true) ?? false;
    await actor.toggleStatusEffect('cascading', { active: hasCascading });
}

async function autoStatusCorePowerOn(actor)
{
    if (actor.statuses?.has('core_power_active') || isAdditionalStatusUnavailable('core_power_active'))
        return;
    await actor.toggleStatusEffect('core_power_active', { active: true });
}

async function autoStatusCorePowerOff(actor)
{
    if (!actor?.statuses?.has('core_power_active'))
        return;
    await actor.toggleStatusEffect('core_power_active', { active: false });
}

async function setCoreActiveField(actor, active)
{
    if (actor?.type !== 'mech' || !!actor.system?.core_active === active)
        return;
    await actor.update({ 'system.core_active': active });
}

export async function corePowerOn(actor)
{
    await autoStatusCorePowerOn(actor);
    await setCoreActiveField(actor, true);
}

export async function corePowerOff(actor)
{
    await autoStatusCorePowerOff(actor);
    await setCoreActiveField(actor, false);
}

function grantsCorePowerStatus(effect)
{
    return effect?.parent?.documentName === 'Actor' && !!effect.statuses?.has('core_power_active');
}

// Hook handlers

function _isTemplateAE(document)
{
    const laFlags = getLAFlags(document);
    return laFlags?.isItemTemplate === true || laFlags?.isActorTemplate === true;
}

function onCreateActiveEffect(document, _change, _userId)
{
    if (!isMasterEnabled())
        return;
    if (_isTemplateAE(document))
        return;
    reconcileStatusFX(document.parent);
}

async function clearValueOfRemovedStatus(effect)
{
    const actor = effect.parent;
    if (actor?.documentName !== 'Actor')
        return;

    const update = {};

    for (const [statusId, path] of Object.entries(VALUE_STATUS_PATHS))
    {
        if (effect.statuses?.has(statusId) && isAutoEnabled(statusId) && (Number(foundry.utils.getProperty(actor, path)) || 0) > 0)
            update[path] = 0;
    }

    if (Object.keys(update).length)
        await actor.update(update);
}

function onDeleteActiveEffect(document, _change, userId)
{
    if (!isMasterEnabled())
        return;
    if (_isTemplateAE(document))
        return;
    reconcileStatusFX(document.parent);
    if (game.userId === userId)
        clearValueOfRemovedStatus(document);
}

function onUpdateActor(actor, change, _options, userId)
{
    if (game.userId !== userId || !isMasterEnabled())
        return;
    if (change.system?.heat !== undefined)
        autoStatusDangerZone(actor);
    if (change.system?.burn !== undefined)
        autoStatusBurn(actor);
    if (change.system?.overshield !== undefined)
        autoStatusOvershield(actor);
    if (change.system?.infection !== undefined)
        autoStatusInfection(actor);
}

async function removeStatusesOnDeath(actor)
{
    const config = getConfig();
    if (!config.removeStatusesOnDeath)
        return;
    if (actor.system.structure.value > 0)
        return;

    const effects = actor.effects.filter(effect => !effect.getFlag('core', 'overlay'));
    if (effects.length === 0)
        return;

    console.log(`${MODULE_ID} | Removing ${effects.length} status(es) from "${actor.name}" (structure 0)`);
    await actor.deleteEmbeddedDocuments('ActiveEffect', effects.map(effect => effect.id));
}

// Conflict avoidance: block csm-lancer-qol's effect handling

function blockQoLEffects()
{
    if (!isMasterEnabled())
        return;
    if (!game.modules.get('csm-lancer-qol')?.active)
        return;

    const qolAutoEnabled = game.settings.get('csm-lancer-qol', 'enableAutomation');
    const qolFXEnabled = game.settings.get('csm-lancer-qol', 'enableConditionEffects');

    if (qolAutoEnabled || qolFXEnabled)
    {
        ui.notifications.warn(
            localize('LA.notify.statusFxOverrideHead') + ' ' +
            localize(qolAutoEnabled && qolFXEnabled ? 'LA.notify.statusFxOverrideBoth' :
                qolAutoEnabled ? 'LA.notify.statusFxOverrideAuto' : 'LA.notify.statusFxOverrideFx') + ' ' +
            localize('LA.notify.statusFxOverrideTail'),
            { permanent: true }
        );
    }
}

// Our filters have no TMFX Anime puppet, so TMFX would push a fresh instance on every flag write.
// A fake puppet in the anime map satisfies the dedupe (TMFX drops it with the filter). Every LA filter type must be listed here.
const _NON_ANIME_FILTER_TYPES = new Set(['chains', 'fracture', 'chromaRot', 'openSeams', 'trackingGhost', 'seamBeat', 'doubleShell', 'ventColumn', 'guidingLight', 'ablativeCrust', 'noDrift', 'shatterSeams', 'thermalSplit', 'slicePlane', 'overflowWrap', 'errorCorrection', 'coldSoak', 'ricochetLip', 'convectionChurn', 'sliceTear', 'toonFlames', 'naniteSwarm', 'feverThrob', 'codeRain', 'dataBleed', 'filmEcho', 'teslaTremor', 'signalCut', 'outOfFocus', 'chromaRotPlus', 'chainSets', 'recoil', 'forgeSeams', 'heatPurge', 'thermalScan', 'shedPlates', 'platingDrip', 'wireFrame', 'grindSparks', 'cutTorch', 'crackShell']);

function _ensureFakePuppetsForCustomFilters(token)
{
    const tokenMagic = /** @type {any} */ (globalThis).TokenMagic;
    const animeMap = tokenMagic?._getAnimeMap?.();

    if (!animeMap)
        return;

    const flagFilters = token.document?.flags?.tokenmagic?.filters ?? [];

    for (const flagEntry of flagFilters)
    {
        const tmFilter = flagEntry?.tmFilters;
        if (!tmFilter || !_NON_ANIME_FILTER_TYPES.has(tmFilter.tmFilterType))
            continue;

        const placeableId = tmFilter.tmParams?.placeableId;
        const filterId = tmFilter.tmFilterId;
        const filterInternalId = tmFilter.tmFilterInternalId;
        let exists = false;

        for (const anime of animeMap.values())
        {
            const puppet = anime?.puppet;

            if (puppet?.placeableId === placeableId
                && puppet?.filterId === filterId
                && (!('filterInternalId' in puppet) || puppet.filterInternalId === filterInternalId))
            {
                exists = true;
                break;
            }
        }

        if (exists)
            continue;

        const id = foundry.utils.randomID();
        animeMap.set(id, {
            animeId: id,
            puppet: {
                placeableId,
                filterId,
                filterInternalId,
                enabled: false,
                animated: null,
                setTMParams()
                { /* TMFX calls this on the puppet during its update branch */ },
                normalizeTMParams()
                { /* same */ },
                hasOwnProperty(prop)
                {
                    return prop in this;
                }
            },
            animate()
            { /* no-op */ }
        });
    }
}

// Sync TMFX filters with actor AE state; debounced to coalesce bursts and avoid races
async function _doReconcileStatusFX(actor)
{
    if (!isMasterEnabled() || typeof TokenMagic === 'undefined' || !actor)
        return;

    const tokens = actor.getActiveTokens?.() ?? [];
    if (!tokens.length)
        return;

    const aeNames = new Set((actor.effects ?? []).map(effect => effect.name));

    for (const token of tokens)
    {
        for (const entry of EFFECT_MAP.map(resolveEntry))
        {
            const wantFilter = aeNames.has(entry.name) && isFXEnabled(entry.key);
            const hasFilter = entry.filterIds.some(filterId => TokenMagic.hasFilterId(token, filterId));

            if (wantFilter && !hasFilter)
            {
                for (const filterId of entry.staleFilterIds ?? [])
                {
                    if (TokenMagic.hasFilterId(token, filterId))
                        await _writeFilters(token, () => token.TMFXdeleteFilters(filterId));
                }

                let preset = entry.preset;
                if (entry.key === 'overheated' && isEnkiduFrame(actor))
                    preset = enkiduOverheatedEffect;

                if ((entry.name === 'Flying' || entry.name === 'Hover') && getIsoProvider(token.scene))
                {
                    const base = entry.name === 'Hover'
                        ? flyingEffectIso.map(filter => ({ ...filter, filterId: filter.filterId.replace('Flying', 'Hover') }))
                        : flyingEffectIso;

                    preset = base;
                }

                if (getConfig().lowQuality && LOW_QUALITY_PRESETS[entry.key])
                {
                    preset = (entry.key === 'overheated' && isEnkiduFrame(actor))
                        ? enkiduOverheatedEffectLite
                        : LOW_QUALITY_PRESETS[entry.key];
                }

                // TMFX stamps filterInternalId/rank/placeableId into what it is handed, so never the const.
                await _writeFilters(token, () => token.TMFXaddUpdateFilters(foundry.utils.duplicate(preset)));
            }
            else if (!wantFilter && hasFilter)
            {
                for (const filterId of allFilterIds(entry))
                {
                    if (TokenMagic.hasFilterId(token, filterId))
                        await _writeFilters(token, () => token.TMFXdeleteFilters(filterId));
                }
            }
        }
    }
}

// A filter rebuilt without a puppet lands on the mesh as a second instance; keep the first of each id.
function _dedupeMeshFilters(token)
{
    const mesh = token.mesh;
    if (!mesh?.filters?.length)
        return;

    const seenIds = new Set();
    mesh.filters = mesh.filters.filter(filter =>
    {
        const id = filter.filterId;
        if (!id)
            return true;
        if (seenIds.has(id))
            return false;
        seenIds.add(id);
        return true;
    });
}

const _CUSTOM_FILTER_CLASSES = new Set(Object.values(customFilterClasses));

function _pruneOrphanCustomFilters(token)
{
    const mesh = token?.mesh;
    if (!mesh?.filters?.length)
        return;

    const flagIds = new Set((token.document?.flags?.tokenmagic?.filters ?? []).map(flagEntry => flagEntry?.tmFilters?.tmFilterId));

    const kept = mesh.filters.filter(filter =>
    {
        if (!_CUSTOM_FILTER_CLASSES.has(filter.constructor) || flagIds.has(filter.filterId))
            return true;
        filter.enabled = false;
        filter.destroy();
        return false;
    });

    if (kept.length !== mesh.filters.length)
        mesh.filters = kept.length ? kept : null;
    _dedupeMeshFilters(token);
}

// Every flag write re-enters TMFX's rebuild, so puppets go in before it and the mesh is swept after.
async function _writeFilters(token, write)
{
    _ensureFakePuppetsForCustomFilters(token);
    await write();
    _dedupeMeshFilters(token);
}

const _reconcileTimers = new Map();

function reconcileStatusFX(actor)
{
    if (!actor?.uuid)
        return;
    if (!actor.isOwner)
        return;

    const prev = _reconcileTimers.get(actor.uuid);
    if (prev)
        clearTimeout(prev);

    const timer = setTimeout(() =>
    {
        _reconcileTimers.delete(actor.uuid);
        _doReconcileStatusFX(actor);
    }, 50);

    _reconcileTimers.set(actor.uuid, timer);
}

// TMFX restores fracture/chains from flags frozen; drop them so reconcile rebuilds them live.
async function _reapplyCustomFiltersAfterLoad()
{
    if (!isMasterEnabled() || typeof TokenMagic === 'undefined')
        return;

    const customEntries = EFFECT_MAP.filter(entry =>
        entry.preset?.some?.(filter => _NON_ANIME_FILTER_TYPES.has(filter.filterType)));

    for (const token of canvas?.tokens?.placeables ?? [])
    {
        const actor = token.actor;
        if (!actor?.isOwner)
            continue;

        const aeNames = new Set((actor.effects ?? []).map(effect => effect.name));
        let relevant = false;

        for (const entry of customEntries)
        {
            if (aeNames.has(entry.name) && isFXEnabled(entry.key))
                relevant = true;

            for (const filterId of allFilterIds(entry))
            {
                if (TokenMagic.hasFilterId(token, filterId))
                {
                    await _writeFilters(token, () => token.TMFXdeleteFilters(filterId));
                    relevant = true;
                }
            }
        }

        if (relevant)
            reconcileStatusFX(actor);
    }
}

// Initialization

export function initStatusFX()
{
    Hooks.on('updateActor', (actor, change, _options, userId) =>
    {
        if (game.userId === userId && /** @type {any} */ (change).system?.structure?.value !== undefined)
            removeStatusesOnDeath(actor);
    });
    if (!isMasterEnabled())
        return;

    Hooks.on('createActiveEffect', onCreateActiveEffect);
    Hooks.on('deleteActiveEffect', onDeleteActiveEffect);
    Hooks.on('updateActor', (actor, _change, _options, _userId) =>
    {
        onUpdateActor(actor, _change, _options, _userId);
        reconcileStatusFX(actor);
    });
    Hooks.on('updateItem', (item, change, _options, userId) =>
    {
        if (game.userId !== userId || !isMasterEnabled())
            return;
        if (change.system?.cascading !== undefined && item.parent)
            autoStatusCascading(item.parent);
    });

    Hooks.on('updateToken', (document, change) =>
    {
        const tmfxChange = /** @type {any} */ (change.flags)?.tokenmagic;
        if (!tmfxChange || !('filters' in tmfxChange || '-=filters' in tmfxChange))
            return;

        const token = document.object;
        if (token)
            setTimeout(() => _pruneOrphanCustomFilters(token), 0);
    });

    Hooks.on('canvasReady', () => setTimeout(_reapplyCustomFiltersAfterLoad, 300));
    if (canvas?.ready)
        setTimeout(_reapplyCustomFiltersAfterLoad, 300);

    blockQoLEffects();

    console.log(`${MODULE_ID} | StatusFX initialized`);
}

Hooks.once('lancer.registerFlows', (steps, flows) =>
{
    steps.set('addCorePowerSE', async ({ actor }) =>
    {
        await corePowerOn(actor);
        return true;
    });
    flows.get('CoreActiveFlow')?.insertStepAfter('consumeCorePower', 'addCorePowerSE');
});

Hooks.on('preDeleteCombatant', (combatant) =>
{
    if (combatant.actor)
        corePowerOff(combatant.actor);
});

Hooks.on('preDeleteCombat', (combat) =>
{
    for (const combatant of combat.combatants ?? [])
    {
        if (combatant.actor)
            corePowerOff(combatant.actor);
    }
});

Hooks.on('createActiveEffect', (effect, _options, userId) =>
{
    if (userId === game.user.id && grantsCorePowerStatus(effect))
        setCoreActiveField(effect.parent, true);
});

Hooks.on('deleteActiveEffect', (effect, _options, userId) =>
{
    if (userId !== game.user.id || !grantsCorePowerStatus(effect))
        return;

    const actor = effect.parent;
    if (!actor.effects.some(other => other.id !== effect.id && !other.disabled && other.statuses?.has('core_power_active')))
        setCoreActiveField(actor, false);
});

Hooks.on('updateActor', (actor, changes, _options, userId) =>
{
    if (userId !== game.user.id || !foundry.utils.hasProperty(changes, 'system.core_active'))
        return;
    if (actor.system.core_active)
        autoStatusCorePowerOn(actor);
    else
        autoStatusCorePowerOff(actor);
});
