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
const SETTING_FX_CONFIG = 'statusFXConfig';

// Effect definitions

const FX_DEFAULTS = {
    // Master toggle
    master: true,
    // Swap heavy bloom/glow presets for outline-only variants.
    lowQuality: false,
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
};

// One ordered list feeds both the config window and the settings menu, so a new key cannot be missed on one.
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

function isAutoEnabled(key)
{
    if (!isMasterEnabled())
        return false;
    return getConfig()[`auto_${key}`] ?? false;
}

// Config Window (FormApplication)

export class StatusFXConfig extends FormApplication
{
    static get defaultOptions()
    {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'la-statusfx-config',
            title: localize('LA.statusFx.windowTitle'),
            template: `modules/${MODULE_ID}/templates/statusfx-config.html`,
            width: 500,
            closeOnSubmit: true,
        });
    }

    getData()
    {
        const config = getConfig();
        const additionalStatuses = getModuleSetting('additionalStatuses', true);
        const hasWeaponFX = !!game.modules.get('lancer-weapon-fx')?.active;
        return {
            master: config.master,
            lowQuality: !!config.lowQuality,
            additionalStatuses,
            actionFX: config.actionFX !== false,
            hasWeaponFX,
            fxEffects: STATUS_FX_KEYS.map(key => ({
                key,
                label: localize(`LA.settingsMenus.statusFx.fx_${key}.label`),
                enabled: config[`fx_${key}`],
            })),
            autoStatuses: [
                { key: 'dangerZone',  label: localize('LA.settingsMenus.statusFx.auto_dangerZone.label'), enabled: config.auto_dangerZone },
                { key: 'burn',        label: localize('LA.settingsMenus.statusFx.auto_burn.label'), enabled: config.auto_burn },
                { key: 'overshield',  label: localize('LA.settingsMenus.statusFx.auto_overshield.label'), enabled: config.auto_overshield },
                { key: 'infection',   label: localize('LA.settingsMenus.statusFx.auto_infection.label'), enabled: config.auto_infection },
                { key: 'cascading',   label: localize('LA.settingsMenus.statusFx.auto_cascading.label'), enabled: config.auto_cascading },
            ],
            removeStatusesOnDeath: config.removeStatusesOnDeath ?? false
        };
    }

    async _updateObject(_event, formData)
    {
        const config = getConfig();
        for (const [key, value] of Object.entries(formData))
        {
            // additionalStatuses is saved separately below
            if (key === 'additionalStatuses')
                continue;
            config[key] = value;
        }
        await game.settings.set(MODULE_ID, SETTING_FX_CONFIG, config);

        // additionalStatuses is its own world setting, not part of statusFXConfig
        if ('additionalStatuses' in formData)
        {
            try
            {
                await game.settings.set(MODULE_ID, 'additionalStatuses', !!formData.additionalStatuses);
            }
            catch (e)
            {
                console.warn(`${MODULE_ID} | Could not save additionalStatuses setting`, e);
            }
        }

        ui.notifications.info(localize('LA.notify.statusfxConfigurationSaved'));

        if (config.actionFX !== false && !game.modules.get('jb2a_patreon')?.active)
            ui.notifications.warn(localize('LA.notify.someActionFxUseJb2aPatreonAssets'));

        try
        {
            /** @type {any} */
            const dialogOpts = {
                id: 'reload-world-confirm',
                modal: true,
                rejectClose: false,
                window: { title: 'SETTINGS.ReloadPromptTitle' },
                position: { width: 400 },
                content: `<p>${game.i18n.localize('SETTINGS.ReloadPromptBody')}</p>`,
            };
            const reload = await foundry.applications.api.DialogV2.confirm(dialogOpts);
            if (reload)
            {
                if (game.user.can('SETTINGS_MODIFY'))
                    game.socket.emit('reload');
                foundry.utils.debouncedReload();
            }
        }
        catch (e)
        {
            console.warn(`${MODULE_ID} | reload-confirm dialog failed`, e);
        }
    }
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
        filterType: "shadow",
        filterId: "jammedShadow",
        blur: 2,
        quality: 3,
        distance: 0,
        alpha: 1,
        padding: 20,
        color: 0xFFFFFF,
        animated: {
            blur: { active: true, loopDuration: 500, animType: "syncCosOscillation", val1: 2, val2: 4 }
        }
    },
    {
        filterType: "electric",
        filterId: "jammedElectric",
        color: 0x0033FF,
        time: 0,
        blend: 2,
        intensity: 1,
        animated: {
            time: { active: true, speed: 0.0020, animType: "move" }
        }
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
        filterType: "shatterSeams",
        filterId: "ExposedShatter",
        blocks: 10,
        jitter: 0.85,
        gapMin: 0.0,
        gapMax: 0.1,
        breathRate: 1.5,
        misalignChance: 1,
        seamColor: 0xff2d3c,
        seamCore: 0xffb0a0,
        seamGain: 1.0,
        lipColor: 0xffeddb,
        lipGain: 0.4,
        lipW: 0.08,
        lightAngle: 30,
        opacity: 0.96,
        timeSpeed: 1
    },
    {
        filterType: "glow",
        filterId: "ExposedGlow",
        outerStrength: 1,
        innerStrength: 0,
        color: 0xff2d3c,
        quality: 0.5,
        padding: 10,
        animated: {
            outerStrength: { active: true, loopDuration: 3000, animType: "cosOscillation", val1: 0.5, val2: 1 }
        }
    },
    {
        filterType: "adjustment",
        filterId: "ExposedAdjust",
        saturation: 1.1,
        brightness: 1,
        contrast: 1,
        red: 1.25,
        green: 0.85,
        blue: 0.85,
        animated: {
            brightness: { active: true, loopDuration: 2000, animType: "syncCosOscillation", val1: 0.9, val2: 1.15 }
        }
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
        filterType: "oldfilm",
        filterId: "DazedFilm",
        sepia: 0,
        noise: 0.3,
        noiseSize: 1.0,
        scratch: 0.9,
        scratchDensity: 0.6,
        scratchWidth: 1.2,
        vignetting: 0.6,
        vignettingAlpha: 0.5,
        vignettingBlur: 0.2,
        animated: {
            seed: { active: true, animType: "randomNumber", val1: 0, val2: 1 },
            vignetting: { active: true, animType: "syncCosOscillation", loopDuration: 2000, val1: 0.2, val2: 0.4 }
        }
    },
    {
        filterType: "outline",
        filterId: "DazedOutline",
        color: 0x000000,
        thickness: 0,
        zOrder: 61
    }
];

const stunnedEffect = [
    {
        filterType: "oldfilm",
        filterId: "StunnedFilm",
        sepia: 0,
        noise: 0.4,
        noiseSize: 1.0,
        scratch: 1.0,
        scratchDensity: 0.8,
        scratchWidth: 1.5,
        vignetting: 0,
        vignettingAlpha: 0,
        vignettingBlur: 0,
        animated: {
            seed: { active: true, animType: "randomNumber", val1: 0, val2: 1 }
        }
    },
    {
        filterType: "outline",
        filterId: "StunnedOutline",
        color: 0x000000,
        thickness: 0,
        zOrder: 61
    },
    {
        filterType: "electric",
        filterId: "StunnedElectric",
        color: 0xffdd33,
        time: 0,
        blend: 2,
        intensity: 1,
        animated: {
            time: { active: true, speed: 0.0020, animType: "move" }
        }
    }
];

const impairedEffect = [
    {
        filterType: "chromaRot",
        filterId: "ImpairedRot",
        color: 0xb8bcc2,
        blocks: 35,
        drift: 0.115,
        levels: 4,
        strength: 0.62,
        dropThreshold: 0.46,
        rotThreshold: 0.9,
        stepRate: 6,
        lockPeriod: 2.7,
        lockWidth: 0,
        rollPeriod: 4,
        opacity: 0.85,
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
        filterType: "distortion",
        filterId: "VulnerableDistortion",
        maskPath: "modules/tokenmagic/fx/assets/distortion-1.png",
        maskSpriteScaleX: 7,
        maskSpriteScaleY: 7,
        padding: 10,
        animated: {
            maskSpriteX: { active: true, speed: 0.02, animType: "move" },
            maskSpriteY: { active: true, speed: 0.03, animType: "move" }
        }
    },
    {
        filterType: "thermalSplit",
        filterId: "VulnerableCracks",
        hotColor: 0xff1900,
        charColor: 0x2a1410,
        coreColor: 0xfef6de,
        crackScale: 13.5,
        breathPeriod: 2.6,
        widthMin: 0.0,
        widthMax: 0.04,
        driftSpeed: 0.75,
        writheAmp: 1.25,
        writheRate: 0.18,
        bloom: 0.95,
        heat: 1.65,
        coreAmt: 0.9,
        charAmt: 0.75,
        flowRate: 0.66,
        flowDepth: 0.6,
        opacity: 0.97,
        timeSpeed: 1.0
    },
    {
        filterType: "outline",
        filterId: "VulnerableOutline",
        padding: 10,
        color: 0xff6600,
        thickness: 1,
        quality: 5,
        zOrder: 10,
        animated: {
            thickness: { active: true, loopDuration: 3000, animType: "syncCosOscillation", val1: 0.5, val2: 2 }
        }
    },
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
        filterId: "ProneNoDrift",
        ghostColor: 0x94a6b8,
        snapColor: 0xe8f2ff,
        bearing: 180,
        tryPeriod: 3.4,
        slip: 0.03,
        ghostStrength: 0.3,
        holdStrength: 0.15,
        snapStrength: 0.75,
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
        filterType: "ablativeCrust",
        filterId: "ResistAllCrust",
        crustColor: 0xc9a882,
        coreColor: 0xffd8a0,
        crustWidth: 0.012,
        segments: 10,
        shedPeriod: 3.2,
        shedDrift: 0.09,
        reverse: 1,
        grainScale: 200,
        lipStrength: 0.0,
        opacity: 0.52,
        padding: 32,
        timeSpeed: 1.0
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
        filterType: "shatterSeams",
        filterId: "ShreddedShatter",
        blocks: 20,
        jitter: 0.85,
        gapMin: 0.0,
        gapMax: 0.105,
        breathRate: 3.5,
        misalignChance: 1,
        seamColor: 0x786559,
        seamCore: 0xc4a98e,
        seamGain: 1.0,
        lipColor: 0xffeddb,
        lipGain: 0.4,
        lipW: 0.08,
        lightAngle: 30,
        opacity: 0.96,
        timeSpeed: 1.0
    },
    {
        filterType: "glow",
        filterId: "ShreddedGlow",
        outerStrength: 1,
        innerStrength: 0,
        color: 0x786559,
        quality: 0.5,
        padding: 10,
        animated: {
            outerStrength: { active: true, loopDuration: 3000, animType: "cosOscillation", val1: 0.5, val2: 1 }
        }
    },
    {
        filterType: "adjustment",
        filterId: "ShreddedAdjust",
        saturation: 1.1,
        brightness: 1,
        contrast: 1,
        red: 1.1,
        green: 1,
        blue: 0.8,
        animated: {
            brightness: { active: true, loopDuration: 2000, animType: "syncCosOscillation", val1: 0.9, val2: 1.15 }
        }
    },
];

const strippedEffect = [
    {
        filterType: "shatterSeams",
        filterId: "StrippedShatter",
        blocks: 20,
        jitter: 0.85,
        gapMin: 0.0,
        gapMax: 0.105,
        breathRate: 3.5,
        misalignChance: 1,
        seamColor: 0x786559,
        seamCore: 0xc4a98e,
        seamGain: 1.0,
        lipColor: 0xffeddb,
        lipGain: 0.4,
        lipW: 0.08,
        lightAngle: 30,
        opacity: 0.96,
        timeSpeed: 1.0
    },
    {
        filterType: "glow",
        filterId: "StrippedGlow",
        outerStrength: 1,
        innerStrength: 0,
        color: 0x786559,
        quality: 0.5,
        padding: 10,
        animated: {
            outerStrength: { active: true, loopDuration: 3000, animType: "cosOscillation", val1: 0.5, val2: 1 }
        }
    },
    {
        filterType: "adjustment",
        filterId: "StrippedAdjust",
        saturation: 0.8,
        brightness: 1,
        contrast: 1,
        red: 0.85,
        green: 0.9,
        blue: 1.1,
        animated: {
            brightness: { active: true, loopDuration: 2000, animType: "syncCosOscillation", val1: 0.9, val2: 1.1 }
        }
    }
];

const slowedEffect = [
    {
        filterType: "overflowWrap",
        filterId: "SlowedBands",
        lineColor: 0x9e9e9e,
        period: 1.1,
        lines: 8,
        thickness: 0.33,
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
        filterType: "chains",
        filterId: "ImmobilizedChains",
        color: 0xccaa66,
        intensity: 1.6,
        scale: 3,
        linkWidth: 0.02,
        linkGap: 1.5,
        opacity: 0.5,
        blend: 2,
        timeSpeed: 0.5
    },
    {
        filterType: "glow",
        filterId: "ImmobilizedGlow",
        outerStrength: 1.5,
        innerStrength: 0,
        color: 0xccaa66,
        quality: 0.5,
        padding: 10,
        animated: {
            outerStrength: { active: true, loopDuration: 3000, animType: "cosOscillation", val1: 0.5, val2: 2 }
        }
    }
];

const staggeredEffect = [
    {
        filterType: "chains",
        filterId: "StaggeredChains",
        color: 0x9944cc,
        intensity: 1.6,
        scale: 3,
        linkWidth: 0.02,
        linkGap: 1.5,
        opacity: 0.5,
        blend: 2,
        timeSpeed: 0.5
    },
    {
        filterType: "glow",
        filterId: "StaggeredGlow",
        outerStrength: 1.5,
        innerStrength: 0,
        color: 0x9944cc,
        quality: 0.5,
        padding: 10,
        animated: {
            outerStrength: { active: true, loopDuration: 3000, animType: "cosOscillation", val1: 0.5, val2: 2 }
        }
    }
];

const blindedEffect = [
    {
        filterType: "crt",
        filterId: "BlindedCRT",
        lineWidth: 3,
        lineContrast: 0.4,
        noise: 0.1,
        noiseSize: 1.5,
        curvature: 0,
        verticalLine: false,
        vignetting: 0,
        time: 0,
        animated: {
            time: { active: true, speed: 0.004, animType: "move" },
            lineContrast: { active: true, loopDuration: 2000, animType: "syncCosOscillation", val1: 0.2, val2: 0.5 }
        }
    },
    {
        filterType: "adjustment",
        filterId: "BlindedAdjust",
        saturation: 0.5,
        brightness: 0.95,
        contrast: 1.1
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

const jammedEffectLite = [
    {
        filterType: "electric",
        filterId: "jammedElectric",
        color: 0x0033FF,
        time: 0,
        blend: 2,
        intensity: 1,
        animated: { time: { active: true, speed: 0.0020, animType: "move" } }
    }
];

const LOW_QUALITY_PRESETS = {
    overheated: overheatedEffectLite,
    corePower: corePowerEffectLite,
    jammed: jammedEffectLite,
};

// Effect Map

// staleFilterIds are cleaned up but never added, so a dropped filter is not orphaned on old tokens.
const allFilterIds = entry => entry.staleFilterIds ? [...entry.filterIds, ...entry.staleFilterIds] : entry.filterIds;

const EFFECT_MAP = [
    { name: 'Danger Zone', key: 'dangerZone', preset: dangerZoneEffect, filterIds: ['DangerZoneVent'], staleFilterIds: ['DangerZoneGlow', 'DangerZoneBloom'] },
    { name: 'Burn',        key: 'burn',       preset: burnEffect,       filterIds: ['BurnGlow'] },
    { name: 'Overshield',  key: 'overshield', preset: overshieldEffect, filterIds: ['OverShieldShell'], staleFilterIds: ['OverShieldGlow'] },
    { name: 'Cascading',   key: 'cascading',  preset: cascadingEffect,  filterIds: ['CascadingTear'], staleFilterIds: ['cascading1', 'cascading2'] },
    { name: 'Invisible',   key: 'invisible',  preset: invisibleEffect,  filterIds: ['invisible'] },
    { name: 'Hidden',      key: 'hidden',     preset: hiddenEffect,     filterIds: ['hidden'] },
    { name: 'Brace',       key: 'brace',      preset: braceEffect,      filterIds: ['brace'] },
    { name: 'Jammed',      key: 'jammed',     preset: jammedEffect,     filterIds: ['jammedShadow', 'jammedElectric'] },
    { name: 'Intangible',  key: 'intangible', preset: intangibleEffect, filterIds: ['intangible1', 'intangible2', 'intangible3'] },
    { name: 'Infection',   key: 'infection',  preset: infectionEffect,  filterIds: ['InfectionGlow'] },
    { name: 'Exposed',    key: 'exposed',   preset: exposedEffect,   filterIds: ['ExposedShatter', 'ExposedGlow', 'ExposedAdjust'], staleFilterIds: ['ExposedDistortion', 'ExposedCracks', 'ExposedOutline', 'ExposedSeams'] },
    { name: 'Falling',    key: 'falling',   preset: fallingEffect,   filterIds: ['FallingSmoke'] },
    { name: 'Dazed',      key: 'dazed',     preset: dazedEffect,     filterIds: ['DazedFilm', 'DazedOutline'] },
    { name: 'Stunned',    key: 'stunned',   preset: stunnedEffect,   filterIds: ['StunnedFilm', 'StunnedOutline', 'StunnedElectric'] },
    { name: 'Impaired',   key: 'impaired',  preset: impairedEffect,  filterIds: ['ImpairedRot'] },
    { name: 'Vulnerable', key: 'vulnerable', preset: vulnerableEffect, filterIds: ['VulnerableDistortion', 'VulnerableCracks', 'VulnerableOutline'], staleFilterIds: ['VulnerableShatter', 'VulnerableGlow', 'VulnerableAdjust', 'VulnerableSeams'] },
    { name: 'Lock On',    key: 'lockOn',     preset: lockOnEffect,     filterIds: ['LockOnGhost'] },
    { name: 'Aided',      key: 'aided',      preset: aidedEffect,      filterIds: ['AidedGleam'] },
    { name: 'Resist All', key: 'resistAll',  preset: resistAllEffect,  filterIds: ['ResistAllCrust'] },
    { name: 'Phasing',    key: 'phasing',    preset: phasingEffect,    filterIds: ['PhasingSlice'] },
    { name: 'Overheated', key: 'overheated', preset: overheatedEffect, filterIds: ['OverheatedChurn', 'OverheatedGlow', 'OverheatedBloom'], staleFilterIds: ['OverheatedWave', 'OverheatedCracks'] },
    { name: 'Reactor Meltdown', key: 'reactorMeltdown', preset: reactorMeltdownEffect, filterIds: ['MeltdownSeams'] },
    { name: 'Shredded',   key: 'shredded',  preset: shreddedEffect,  filterIds: ['ShreddedShatter', 'ShreddedGlow', 'ShreddedAdjust'], staleFilterIds: ['ShreddedCracks'] },
    { name: 'Stripped',   key: 'shredded',  preset: strippedEffect,  filterIds: ['StrippedShatter', 'StrippedGlow', 'StrippedAdjust'], staleFilterIds: ['StrippedCracks'] },
    { name: 'Prone',      key: 'prone',     preset: proneEffect,     filterIds: ['ProneNoDrift'], staleFilterIds: ['ProneWave', 'ProneGlow'] },
    { name: 'Slowed',     key: 'slowed',    preset: slowedEffect,    filterIds: ['SlowedBands'], staleFilterIds: ['SlowedWave', 'SlowedGlow'] },
    { name: 'Bolster',    key: 'bolstered', preset: bolsteredEffect, filterIds: ['BolsteredBand'] },
    { name: 'Shut Down',  key: 'shutDown',  preset: shutDownEffect,  filterIds: ['ShutDownSoak'] },
    { name: 'Disengage',  key: 'disengage', preset: disengageEffect, filterIds: ['DisengageRounds'] },
    { name: 'Throttled',  key: 'throttled', preset: throttledEffect, filterIds: ['ThrottledCracks', 'ThrottledGlow', 'ThrottledAdjust'] },
    { name: 'Immobilized', key: 'immobilized', preset: immobilizedEffect, filterIds: ['ImmobilizedChains', 'ImmobilizedGlow'] },
    { name: 'Staggered',   key: 'immobilized', preset: staggeredEffect, filterIds: ['StaggeredChains', 'StaggeredGlow'] },
    { name: 'Blinded',    key: 'blinded',     preset: blindedEffect,   filterIds: ['BlindedCRT', 'BlindedAdjust'] },
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
    await actor.toggleStatusEffect('dangerzone', { active: heat.value / heat.max >= 0.5 });
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

function onDeleteActiveEffect(document, _change, _userId)
{
    if (!isMasterEnabled())
        return;
    if (_isTemplateAE(document))
        return;
    reconcileStatusFX(document.parent);
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
    if (change.system?.structure?.value !== undefined)
        removeStatusesOnDeath(actor);
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
const _NON_ANIME_FILTER_TYPES = new Set(['chains', 'fracture', 'chromaRot', 'openSeams', 'trackingGhost', 'seamBeat', 'doubleShell', 'ventColumn', 'guidingLight', 'ablativeCrust', 'noDrift', 'shatterSeams', 'thermalSplit', 'slicePlane', 'overflowWrap', 'errorCorrection', 'coldSoak', 'ricochetLip', 'convectionChurn', 'sliceTear']);
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
        for (const entry of EFFECT_MAP)
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
    if (!actor?.id)
        return;
    if (!actor.isOwner)
        return;
    const prev = _reconcileTimers.get(actor.id);
    if (prev)
        clearTimeout(prev);
    const timer = setTimeout(() =>
    {
        _reconcileTimers.delete(actor.id);
        _doReconcileStatusFX(actor);
    }, 50);
    _reconcileTimers.set(actor.id, timer);
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

    // Core Power Active: remove on combat end / combatant removed.
    // (Activation registration is at module load time; see bottom of file.)
    Hooks.on('preDeleteCombatant', (combatant) =>
    {
        if (combatant.actor)
            autoStatusCorePowerOff(combatant.actor);
    });
    Hooks.on('preDeleteCombat', (combat) =>
    {
        for (const combatant of combat.combatants ?? [])
        {
            if (combatant.actor)
                autoStatusCorePowerOff(combatant.actor);
        }
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
        await autoStatusCorePowerOn(actor);
        return true;
    });
    flows.get('CoreActiveFlow')?.insertStepAfter('consumeCorePower', 'addCorePowerSE');
});
