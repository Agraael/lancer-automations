/**
 * StatusFX — TokenMagic visual effects for Lancer statuses
 */
/*global TokenMagic */

const MODULE_ID = 'lancer-automations';
const SETTING_FX_CONFIG = 'statusFXConfig';

// ---------------------------------------------------------------------------
// Effect definitions
// ---------------------------------------------------------------------------

const FX_DEFAULTS = {
    // Master toggle
    master: true,
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
    fx_shredded:    true,
    fx_slowed:      true,
    fx_throttled:   true,
    fx_immobilized:   true,
    fx_blinded:     true,
    fx_flying:      true,
    // Auto-status toggles
    auto_dangerZone:  true,
    auto_burn:        true,
    auto_overshield:  true,
    auto_infection:   true,
};

function getConfig() {
    try {
        const stored = game.settings.get(MODULE_ID, SETTING_FX_CONFIG);
        return { ...FX_DEFAULTS, ...stored };
    } catch {
        return { ...FX_DEFAULTS };
    }
}

function isMasterEnabled() {
    try {
        return getConfig().master;
    } catch {
        return false;
    }
}

function isFXEnabled(key) {
    if (!isMasterEnabled())
        return false;
    return getConfig()[`fx_${key}`] ?? false;
}

function isAutoEnabled(key) {
    if (!isMasterEnabled())
        return false;
    return getConfig()[`auto_${key}`] ?? false;
}

// ---------------------------------------------------------------------------
// Config Window (FormApplication)
// ---------------------------------------------------------------------------

class StatusFXConfig extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'la-statusfx-config',
            title: 'Lancer Automations — Status FX Configuration',
            template: `modules/${MODULE_ID}/templates/statusfx-config.html`,
            width: 500,
            closeOnSubmit: true,
        });
    }

    getData() {
        const config = getConfig();
        let additionalStatuses = true;
        try {
            additionalStatuses = game.settings.get(MODULE_ID, 'additionalStatuses');
        } catch { /* setting may not be registered yet */ }
        return {
            master: config.master,
            additionalStatuses,
            fxEffects: [
                { key: 'dangerZone',  label: 'Danger Zone Glow',   enabled: config.fx_dangerZone },
                { key: 'burn',        label: 'Burn Glow',           enabled: config.fx_burn },
                { key: 'overshield',  label: 'Overshield Glow',     enabled: config.fx_overshield },
                { key: 'cascading',   label: 'Cascading Effect',    enabled: config.fx_cascading },
                { key: 'invisible',   label: 'Invisible Effect',    enabled: config.fx_invisible },
                { key: 'hidden',      label: 'Hidden Effect',       enabled: config.fx_hidden },
                { key: 'brace',       label: 'Brace Shield Effect', enabled: config.fx_brace },
                { key: 'jammed',      label: 'Jammed Effect',       enabled: config.fx_jammed },
                { key: 'intangible',  label: 'Intangible Effect',   enabled: config.fx_intangible },
                { key: 'infection',   label: 'Infection Glow',      enabled: config.fx_infection },
                { key: 'exposed',    label: 'Exposed Effect',      enabled: config.fx_exposed },
                { key: 'falling',    label: 'Falling Effect',      enabled: config.fx_falling },
                { key: 'dazed',      label: 'Dazed Effect',        enabled: config.fx_dazed },
                { key: 'stunned',    label: 'Stunned Effect',      enabled: config.fx_stunned },
                { key: 'shredded',   label: 'Shredded / Stripped Effect', enabled: config.fx_shredded },
                { key: 'slowed',     label: 'Slowed Effect',       enabled: config.fx_slowed },
                { key: 'throttled',  label: 'Throttled Effect',    enabled: config.fx_throttled },
                { key: 'immobilized', label: 'Immobilized / Staggered Effect', enabled: config.fx_immobilized },
                { key: 'blinded',    label: 'Blinded Effect',     enabled: config.fx_blinded },
                { key: 'flying',     label: 'Flying Hover Bob',   enabled: config.fx_flying },
            ],
            autoStatuses: [
                { key: 'dangerZone',  label: 'Auto Danger Zone (heat ≥ 50%)', enabled: config.auto_dangerZone },
                { key: 'burn',        label: 'Auto Burn icon (burn > 0)',      enabled: config.auto_burn },
                { key: 'overshield',  label: 'Auto Overshield icon (OS > 0)',  enabled: config.auto_overshield },
                { key: 'infection',   label: 'Auto Infection icon (infection > 0)', enabled: config.auto_infection },
            ],
            removeStatusesOnDeath: config.removeStatusesOnDeath ?? false
        };
    }

    async _updateObject(_event, formData) {
        const config = getConfig();
        for (const [key, val] of Object.entries(formData)) {
            // additionalStatuses is saved separately below
            if (key === 'additionalStatuses') {
                continue;
            }
            config[key] = val;
        }
        await game.settings.set(MODULE_ID, SETTING_FX_CONFIG, config);

        // additionalStatuses is its own world setting, not part of statusFXConfig
        if ('additionalStatuses' in formData) {
            try {
                await game.settings.set(MODULE_ID, 'additionalStatuses', !!formData.additionalStatuses);
            } catch (e) {
                console.warn(`${MODULE_ID} | Could not save additionalStatuses setting`, e);
            }
        }

        ui.notifications.info('StatusFX configuration saved.');

        try {
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
            if (reload) {
                if (game.user.can('SETTINGS_MODIFY')) {
                    game.socket.emit('reload');
                }
                foundry.utils.debouncedReload();
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | reload-confirm dialog failed`, e);
        }
    }
}

// ---------------------------------------------------------------------------
// Settings registration
// ---------------------------------------------------------------------------

export function registerStatusFXSettings() {
    // Hidden config store (full config object including master toggle)
    game.settings.register(MODULE_ID, SETTING_FX_CONFIG, {
        scope: 'world',
        config: false,
        type: Object,
        default: { ...FX_DEFAULTS },
        requiresReload: true,
    });

    game.settings.registerMenu(MODULE_ID, 'statusFXConfigMenu', {
        name: 'StatusFX Configuration',
        label: 'Configure Effects',
        hint: 'Open the StatusFX configuration window to toggle individual visual effects and auto-status features.',
        icon: 'fas fa-magic',
        type: StatusFXConfig,
        restricted: true,
    });
}

// ---------------------------------------------------------------------------
// TokenMagic Effect Definitions
// ---------------------------------------------------------------------------

const dangerZoneEffect = [
    {
        filterType: "glow",
        filterId: "DangerZoneGlow",
        outerStrength: 4,
        innerStrength: 2,
        color: 0xff9633,
        quality: 0.5,
        padding: 10,
        animated: {
            color: { active: true, loopDuration: 6000, animType: "colorOscillation", val1: 0xEE5500, val2: 0xff9633 },
            outerStrength: { active: true, loopDuration: 6000, animType: "cosOscillation", val1: 2, val2: 5 }
        }
    },
    {
        filterType: "xbloom",
        filterId: "DangerZoneBloom",
        threshold: 0.35,
        bloomScale: 0,
        brightness: 1,
        blur: 0.1,
        padding: 10,
        quality: 15,
        blendMode: 0,
        animated: { bloomScale: { active: true, loopDuration: 6000, animType: "sinOscillation", val1: 0.4, val2: 1.0 } }
    }
];

const enkiduDangerZoneEffect = [
    {
        filterType: "glow",
        filterId: "DangerZoneGlow",
        outerStrength: 4,
        innerStrength: 2,
        color: 0x9c24f2,
        quality: 0.5,
        padding: 10,
        animated: {
            color: { active: true, loopDuration: 6000, animType: "colorOscillation", val1: 0xf224cc, val2: 0x9c24f2 },
            outerStrength: { active: true, loopDuration: 6000, animType: "cosOscillation", val1: 2, val2: 5 }
        }
    },
    {
        filterType: "xbloom",
        filterId: "DangerZoneBloom",
        threshold: 0.35,
        bloomScale: 0,
        brightness: 1,
        blur: 0.1,
        padding: 10,
        quality: 15,
        blendMode: 0,
        animated: { bloomScale: { active: true, loopDuration: 6000, animType: "sinOscillation", val1: 0.4, val2: 1.0 } }
    }
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
        filterType: "outline",
        filterId: "OverShieldGlow",
        padding: 10,
        color: 0x48dee0,
        thickness: 1,
        quality: 5,
        zOrder: 9,
        animated: { thickness: { active: true, loopDuration: 800, animType: "syncCosOscillation", val1: 1, val2: 6 } }
    }
];

const cascadingEffect = [
    {
        filterType: "pixel",
        filterId: "cascading1",
        sizeX: 1,
        sizeY: 1,
        animated: {
            sizeX: { active: true, animType: "halfCosOscillation", loopDuration: 1500, val1: 1, val2: 3 },
            sizeY: { active: true, animType: "halfCosOscillation", loopDuration: 1500, val1: 1, val2: 3 }
        }
    },
    {
        filterType: "bevel",
        filterId: "cascading2",
        rotation: 0,
        thickness: 5,
        lightColor: 0xFF0000,
        lightAlpha: 0.8,
        shadowColor: 0x00FF00,
        shadowAlpha: 0.5,
        animated: { rotation: { active: true, clockWise: true, loopDuration: 1600, animType: "syncRotation" } }
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
        density: 0.65,
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
        quality: 5,
        distance: 0,
        alpha: 1,
        padding: 100,
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
        filterType: "distortion",
        filterId: "ExposedDistortion",
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
        filterType: "adjustment",
        filterId: "ExposedAdjust",
        saturation: 1.2,
        brightness: 1,
        contrast: 1,
        red: 1.2,
        green: 0.9,
        blue: 0.8,
        animated: {
            brightness: { active: true, loopDuration: 2000, animType: "syncCosOscillation", val1: 0.9, val2: 1.15 }
        }
    },
    {
        filterType: "outline",
        filterId: "ExposedOutline",
        padding: 10,
        color: 0xff6600,
        thickness: 1,
        quality: 5,
        zOrder: 10,
        animated: {
            thickness: { active: true, loopDuration: 3000, animType: "syncCosOscillation", val1: 0.5, val2: 2 }
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

const shreddedEffect = [
    {
        filterType: "fracture",
        filterId: "ShreddedCracks",
        color: 0x786559,
        intensity: 3.0,
        scale: 20,
        crackWidth: 0.04,
        opacity: 0.8,
        warpStrength: 1.0,
        noiseScale: 0.0,
        maskAmount: 0.3,
        blend: 2,
        timeSpeed: 0.3
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
        filterType: "fracture",
        filterId: "StrippedCracks",
        color: 0x786559,
        intensity: 3.0,
        scale: 20,
        crackWidth: 0.04,
        opacity: 0.8,
        warpStrength: 1.0,
        noiseScale: 0.0,
        maskAmount: 0.3,
        blend: 2,
        timeSpeed: 0.3
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
        filterType: "wave",
        filterId: "SlowedWave",
        time: 0,
        color: 0xC4B3A9,
        strength: 0.01,
        frequency: 10,
        minIntensity: 0.7,
        maxIntensity: 1.5,
        inward: true,
        animated: {
            time: { active: true, speed: 0.001, animType: "move" }
        }
    },
    {
        filterType: "glow",
        filterId: "SlowedGlow",
        outerStrength: 1.5,
        innerStrength: 0,
        color: 0xC4B3A9,
        quality: 0.5,
        padding: 10,
        animated: {
            outerStrength: { active: true, loopDuration: 4000, animType: "syncCosOscillation", val1: 0.5, val2: 2 }
        }
    }
];

const throttledEffect = [
    {
        filterType: "fracture",
        filterId: "ThrottledCracks",
        color: 0xcc4422,
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
        color: 0xcc4422,
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
        green: 0.85,
        blue: 0.75,
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

// ---------------------------------------------------------------------------
// Effect Map
// ---------------------------------------------------------------------------

const EFFECT_MAP = [
    { name: 'Danger Zone', key: 'dangerZone', preset: dangerZoneEffect, filterIds: ['DangerZoneGlow', 'DangerZoneBloom'] },
    { name: 'Burn',        key: 'burn',       preset: burnEffect,       filterIds: ['BurnGlow'] },
    { name: 'Overshield',  key: 'overshield', preset: overshieldEffect, filterIds: ['OverShieldGlow'] },
    { name: 'Cascading',   key: 'cascading',  preset: cascadingEffect,  filterIds: ['cascading1', 'cascading2'] },
    { name: 'Invisible',   key: 'invisible',  preset: invisibleEffect,  filterIds: ['invisible'] },
    { name: 'Hidden',      key: 'hidden',     preset: hiddenEffect,     filterIds: ['hidden'] },
    { name: 'Brace',       key: 'brace',      preset: braceEffect,      filterIds: ['brace'] },
    { name: 'Jammed',      key: 'jammed',     preset: jammedEffect,     filterIds: ['jammedShadow', 'jammedElectric'] },
    { name: 'Intangible',  key: 'intangible', preset: intangibleEffect, filterIds: ['intangible1', 'intangible2', 'intangible3'] },
    { name: 'Infection',   key: 'infection',  preset: infectionEffect,  filterIds: ['InfectionGlow'] },
    { name: 'Exposed',    key: 'exposed',   preset: exposedEffect,   filterIds: ['ExposedDistortion', 'ExposedAdjust', 'ExposedOutline'] },
    { name: 'Falling',    key: 'falling',   preset: fallingEffect,   filterIds: ['FallingSmoke'] },
    { name: 'Dazed',      key: 'dazed',     preset: dazedEffect,     filterIds: ['DazedFilm', 'DazedOutline'] },
    { name: 'Stunned',    key: 'stunned',   preset: stunnedEffect,   filterIds: ['StunnedFilm', 'StunnedOutline', 'StunnedElectric'] },
    { name: 'Shredded',   key: 'shredded',  preset: shreddedEffect,  filterIds: ['ShreddedCracks', 'ShreddedGlow', 'ShreddedAdjust'] },
    { name: 'Stripped',   key: 'shredded',  preset: strippedEffect,  filterIds: ['StrippedCracks', 'StrippedGlow', 'StrippedAdjust'] },
    { name: 'Slowed',     key: 'slowed',    preset: slowedEffect,    filterIds: ['SlowedWave', 'SlowedGlow'] },
    { name: 'Throttled',  key: 'throttled', preset: throttledEffect, filterIds: ['ThrottledCracks', 'ThrottledGlow', 'ThrottledAdjust'] },
    { name: 'Immobilized', key: 'immobilized', preset: immobilizedEffect, filterIds: ['ImmobilizedChains', 'ImmobilizedGlow'] },
    { name: 'Staggered',   key: 'immobilized', preset: staggeredEffect, filterIds: ['StaggeredChains', 'StaggeredGlow'] },
    { name: 'Blinded',    key: 'blinded',     preset: blindedEffect,   filterIds: ['BlindedCRT', 'BlindedAdjust'] },
    { name: 'Flying',    key: 'flying',      preset: flyingEffect,    filterIds: ['FlyingBob'] },
];

// ---------------------------------------------------------------------------
// Apply / Remove FX
// ---------------------------------------------------------------------------

/** Check if actor has the Enkidu alt frame (Tokugawa alt). */
function isEnkiduFrame(actor) {
    return actor?.items?.filter(i => i.system?.lid === 'mf_tokugawa_alt_enkidu').length > 0;
}

async function applyFX(token, statusName, enable) {
    if (!isMasterEnabled())
        return;
    if (typeof TokenMagic === 'undefined')
        return;

    const entry = EFFECT_MAP.find(e => e.name === statusName);
    if (!entry)
        return;
    if (!isFXEnabled(entry.key))
        return;

    // Enkidu frame gets a purple Danger Zone instead of orange
    let preset = entry.preset;
    if (entry.key === 'dangerZone' && isEnkiduFrame(token.actor)) {
        preset = enkiduDangerZoneEffect;
    }

    if (enable) {
        if (!TokenMagic.hasFilterId(token, entry.filterIds[0])) {
            await token.TMFXaddUpdateFilters(preset);
        }
    } else {
        for (const filterId of entry.filterIds) {
            if (TokenMagic.hasFilterId(token, filterId)) {
                await token.TMFXdeleteFilters(filterId);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Auto-status logic
// ---------------------------------------------------------------------------

async function autoStatusDangerZone(actor) {
    if (!isAutoEnabled('dangerZone'))
        return;
    const heat = actor.system?.heat;
    if (!heat)
        return;
    await actor.toggleStatusEffect('dangerzone', { active: heat.value / heat.max >= 0.5 });
}

async function autoStatusBurn(actor) {
    if (!isAutoEnabled('burn'))
        return;
    const burn = actor.system?.burn;
    if (burn == null)
        return;
    await actor.toggleStatusEffect('burn', { active: burn > 0 });
}

async function autoStatusOvershield(actor) {
    if (!isAutoEnabled('overshield'))
        return;
    const os = actor.system?.overshield?.value;
    if (os == null)
        return;
    await actor.toggleStatusEffect('overshield', { active: os > 0 });
}

async function autoStatusInfection(actor) {
    if (!isAutoEnabled('infection'))
        return;
    const infection = actor.system?.infection ?? 0;
    await actor.toggleStatusEffect('infection', { active: infection > 0 });
}

// ---------------------------------------------------------------------------
// Hook handlers
// ---------------------------------------------------------------------------

function onCreateActiveEffect(document, _change, userId) {
    if (game.userId !== userId || !isMasterEnabled())
        return;
    const token = document.parent?.getActiveTokens?.()?.pop?.();
    if (!token)
        return;
    applyFX(token, document.name, true);
}

function onDeleteActiveEffect(document, _change, userId) {
    if (game.userId !== userId || !isMasterEnabled())
        return;
    const token = document.parent?.getActiveTokens?.()?.pop?.();
    if (!token)
        return;
    applyFX(token, document.name, false);
}

function onUpdateActor(actor, change, _options, userId) {
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

async function removeStatusesOnDeath(actor) {
    const config = getConfig();
    if (!config.removeStatusesOnDeath)
        return;
    if (actor.system.structure.value > 0)
        return;

    const effects = actor.effects.filter(e => !e.getFlag('core', 'overlay'));
    if (effects.length === 0)
        return;

    console.log(`${MODULE_ID} | Removing ${effects.length} status(es) from "${actor.name}" (structure 0)`);
    await actor.deleteEmbeddedDocuments('ActiveEffect', effects.map(e => e.id));
}

// ---------------------------------------------------------------------------
// Conflict avoidance — block csm-lancer-qol's effect handling
// ---------------------------------------------------------------------------

function blockQoLEffects() {
    if (!isMasterEnabled())
        return;
    if (!game.modules.get('csm-lancer-qol')?.active)
        return;

    const qolAutoEnabled = game.settings.get('csm-lancer-qol', 'enableAutomation');
    const qolFXEnabled = game.settings.get('csm-lancer-qol', 'enableConditionEffects');

    if (qolAutoEnabled || qolFXEnabled) {
        ui.notifications.warn(
            'Lancer Automations StatusFX is active — csm-lancer-qol\'s ' +
            (qolAutoEnabled && qolFXEnabled ? 'auto-status and condition effects are' :
                qolAutoEnabled ? 'auto-status is' : 'condition effects are') +
            ' being overridden. Disable them in csm-lancer-qol settings to remove this warning.',
            { permanent: true }
        );
    }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function initStatusFX() {
    if (!isMasterEnabled())
        return;

    Hooks.on('createActiveEffect', onCreateActiveEffect);
    Hooks.on('deleteActiveEffect', onDeleteActiveEffect);
    Hooks.on('updateActor', onUpdateActor);

    blockQoLEffects();

    console.log(`${MODULE_ID} | StatusFX initialized`);
}
