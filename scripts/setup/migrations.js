/* global game, globalThis, Hooks */

import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getLAFlag, setLAFlag } from '../tools/flag-utils.js';
import { isExecutorGM } from '../tools/misc-tools.js';
import { normalizeBonusShape } from '../bonuses/genericBonuses.js';
import { isFreshWorld } from './settings-onboarding.js';

const SETTING_INSTALL_STATE = 'installState_v1';

/** @type {[string, any][]} */
export const CHANGED_DEFAULTS = [
    ['enableBuiltinSpeedProvider', false],
    ['rulerPerStepRender', false],
    ['pathfindDragMovement', false],
    ['enableClimbWaypoints', false],
    ['splitMovementAtTriggerBoundaries', false],
    ['count3DDistance', false],
    ['autoTokenHeight', false],
    ['overlapTokenPicker', false],
    ['attackTargeting', 'picker'],
    ['statRollTargeting', false],
    ['targetInfoDisplay', 'gm'],
    ['autoDamageRoll', false],
    ['autoDamageApply', false],
    ['autoStructFollowup', false],
    ['enableKnockbackFlow', false],
    ['enableOneStructNpc', false],
    ['enablePerRoundTurnTags', false],
    ['resistSelfHeat', false],
    ['scanRevealMode', 'players'],
    ['battleLogEnabled', false],
    ['tokenStatBar', false],
    ['statBarVisibilityOutOfCombat', 'all'],
    ['statBarVisibilityInCombat', 'all'],
    ['statBarShowValues', true],
    ['statBarAutoInjectTalents', false],
    ['statBarEffectIconScale', 1],
    ['tokenStatHintEnabled', false],
    ['tokenStatHintPlacement', 'token'],
    ['tokenStatHintShowHase', false],
    ['tokenStatHintHideCurrentFromPlayers', true],
    ['autoFocusCards', false],
    ['autoFocusAttack', false],
    ['autoFocusDamage', false],
    ['autoFocusCheck', false],
    ['autoFocusActivation', false],
    ['tah.narrativeMode', false],
    ['tah.portrait.mech', 'off'],
    ['tah.portrait.pilot', 'off'],
    ['tah.portrait.npc', 'off'],
    ['tah.portrait.deployable', 'off'],
    ['tah.maxColumnItems', 0],
    ['tah.wheelRadiusOffset', 0],
    ['rangePulseLineWidth', 1],
    ['rangePulseLos', false],
    ['statusHalo', false],
    ['statusHaloRadius', 1.15],
    ['statusHaloStartAngle', 135],
    ['statusIconMinZoomScale', 0],
    ['defaultDeployableArt', false],
    ['lancerSensorCombatOnly', true],
    ['lancerAwarenessCombatOnly', true],
    ['guardianBulwarkAuraMode', 'always'],
    ['consumeReaction', false],
    ['combatCarousel', false],
    ['visionAnimationThrottleFps', 0],
    ['dragVisionRefreshFps', 10],
    ['tacticalDistanceThrottleFps', 10],
];

export const pinnedThisLoad = new Set();

function _priorInstall()
{
    const state = getModuleSetting(SETTING_INSTALL_STATE);
    return state ? state === 'prior' : !isFreshWorld();
}

async function _pinOldDefaults(scope)
{
    if (!_priorInstall())
        return;

    const gmDefaults = new Set((getModuleSetting('gmClientDefaults') ?? []).map(entry => entry?.key));

    for (const [key, oldValue] of CHANGED_DEFAULTS)
    {
        const setting = game.settings.settings.get(/** @type {any} */ (`${MODULE_ID}.${key}`));
        if (!setting || (setting.scope === 'world') !== (scope === 'world'))
            continue;
        if (_storedValue(key, scope) !== undefined || gmDefaults.has(`${MODULE_ID}.${key}`))
            continue;
        await game.settings.set(MODULE_ID, key, oldValue);
        pinnedThisLoad.add(key);
    }
}

/** @type {(value?: any) => void} */
let _resolveMigrations = () => undefined;
export const migrationsDone = new Promise(resolve =>
{
    _resolveMigrations = resolve;
});

function _storedValue(key, scope = 'world')
{
    if (scope !== 'client')
        return game.settings.storage.get('world')?.getSetting(`${MODULE_ID}.${key}`)?.value;

    const raw = globalThis.localStorage.getItem(`${MODULE_ID}.${key}`);
    if (raw === null)
        return undefined;

    try
    {
        return JSON.parse(raw);
    }
    catch
    {
        return raw;
    }
}

async function _reshapeStoredBonuses()
{
    const keys = ['global_bonuses', 'constant_bonuses', 'ephemeral_bonuses', 'bonusTemplates'];

    const reshape = (entry, key) => (key === 'bonusTemplates' && entry?.bonusData
        ? { ...entry, bonusData: normalizeBonusShape(entry.bonusData) }
        : normalizeBonusShape(entry));

    const migrateDoc = async (doc) =>
    {
        for (const key of keys)
        {
            const list = getLAFlag(doc, key);
            if (!Array.isArray(list))
                continue;

            const next = list.map(entry => reshape(entry, key));

            const changed = next.some((entry, index) => (key === 'bonusTemplates'
                ? entry.bonusData !== list[index]?.bonusData
                : entry !== list[index]));

            if (changed)
                await setLAFlag(doc, key, next);
        }
    };

    const migrateActor = async (actor) =>
    {
        await migrateDoc(actor);
        for (const item of actor?.items ?? [])
            await migrateDoc(item);
    };

    for (const actor of game.actors)
        await migrateActor(actor);
    for (const item of game.items)
        await migrateDoc(item);

    for (const scene of game.scenes)
    {
        for (const tokenDoc of scene.tokens)
        {
            if (!tokenDoc.actorLink && tokenDoc.actor)
                await migrateActor(tokenDoc.actor);
        }
    }

    Hooks.callAll('lancer-automations.clearCaches');
}

const MIGRATIONS = [
    {
        // keep pre-4.0 Overwatch notify on for worlds that never saved a choice
        id: 'overwatchDefaultFlip_v1',
        async run()
        {
            const priorInstall = game.settings.storage.get('world')?.contents
                ?.some(setting => setting.key?.startsWith(`${MODULE_ID}.`));

            if (!priorInstall)
                return;

            const saved = getModuleSetting('generalReactions') || {};
            if (saved.Overwatch?.reactions?.some(sub => sub?.enabled !== undefined))
                return;
            saved.Overwatch = { ...saved.Overwatch, reactions: [{ enabled: true }] };
            await game.settings.set(MODULE_ID, 'generalReactions', saved);
            Hooks.callAll('lancer-automations.clearCaches');
        },
    },
    {
        id: 'visionRangeScrub_v1',
        async run()
        {
            if (!getModuleSetting('lancerVisionAutoAdd'))
                return;
            await globalThis.lancerAutoVisionSetup?.();
        },
    },
    {
        id: 'lancerLosModes_v1',
        async run()
        {
            if (!getModuleSetting('lancerVisionAutoAdd'))
                return;
            await globalThis.lancerAutoVisionSetup?.();
        },
    },
    {
        // enableBoostOffer went from a boolean to no / yes / auto
        id: 'boostOfferMode_v1',
        async run()
        {
            const stored = getModuleSetting('enableBoostOffer');
            if (typeof stored !== 'boolean')
                return;
            await game.settings.set(MODULE_ID, 'enableBoostOffer', stored ? 'yes' : 'no');
        },
    },
    {
        id: 'involuntaryMoveSplit_v1',
        async run()
        {
            for (const key of ['customReactions', 'generalReactions'])
            {
                const saved = foundry.utils.deepClone(getModuleSetting(key) || {});
                let changed = false;

                for (const entry of Object.values(saved))
                {
                    for (const automation of (Array.isArray(entry?.reactions) ? entry.reactions : [entry]))
                    {
                        if (!Array.isArray(automation?.triggers) || !automation.triggers.includes('onInvoluntaryMove'))
                            continue;
                        automation.triggers = automation.triggers.map(trigger => (trigger === 'onInvoluntaryMove' ? 'onPreInvoluntaryMove' : trigger));
                        changed = true;
                    }
                }

                if (changed)
                    await game.settings.set(MODULE_ID, key, saved);
            }

            Hooks.callAll('lancer-automations.clearCaches');
        },
    },
    {
        id: 'defenseBonusTypes_v1',
        run: _reshapeStoredBonuses,
    },
    {
        id: 'movementBonusTypes_v1',
        run: _reshapeStoredBonuses,
    },
    {
        id: 'effectGrantedActions_v1',
        async run()
        {
            const names = new Set(["Break Free (Sealant)", "Fall Prone (Sniper's Mark)", "Break Free (Rift)"]);

            const sweep = async (actor) =>
            {
                const list = getLAFlag(actor, 'extraActions');
                if (!Array.isArray(list))
                    return;

                const kept = list.filter(action => action?._addedViaExtrasUI || !names.has(action?.name));
                if (kept.length !== list.length)
                    await setLAFlag(actor, 'extraActions', kept);
            };

            for (const actor of game.actors)
                await sweep(actor);

            for (const scene of game.scenes)
            {
                for (const tokenDoc of scene.tokens)
                {
                    if (!tokenDoc.actorLink && tokenDoc.actor)
                        await sweep(tokenDoc.actor);
                }
            }
        },
    },
    {
        id: 'tah.scopeMigration_clientToWorld_v1',
        run()
        {
            const keys = ['tah.showDisposition'];

            for (const key of keys)
            {
                try
                {
                    const raw = globalThis.localStorage.getItem(`${MODULE_ID}.${key}`);
                    if (raw === null)
                        continue;

                    const value = JSON.parse(raw);
                    const def = game.settings.settings.get(`${MODULE_ID}.${key}`)?.default;

                    if (value === def)
                        continue;
                    game.settings.set(MODULE_ID, key, value);
                }
                catch
                { /* ignore */ }
            }
        },
    },
    {
        id: 'debugMovementMerge_v1',
        async run()
        {
            if (_storedValue('debugPathHexCalculation') === true)
                await game.settings.set(MODULE_ID, 'debugMovement', true);
        },
    },
    {
        id: 'groundShadowZeroOff_v1',
        async run()
        {
            const enabled = _storedValue('tokenGroundShadow') === true;
            const opacity = _storedValue('tokenGroundShadowOpacity');

            if (enabled && opacity === undefined)
                await game.settings.set(MODULE_ID, 'tokenGroundShadowOpacity', 0.55);
            else if (!enabled && opacity !== undefined && Number(opacity) !== 0)
                await game.settings.set(MODULE_ID, 'tokenGroundShadowOpacity', 0);
        },
    },
    {
        id: 'toolCursorsMerge_v1',
        scope: 'client',
        async run()
        {
            const ruler = _storedValue('rulerToolCursor', 'client') ?? true;
            const target = _storedValue('targetToolCursor', 'client') ?? true;

            if (!ruler && target)
                await game.settings.set(MODULE_ID, 'rulerToolCursor', true);
        },
    },
    {
        id: 'tahOpenMode_v1',
        scope: 'client',
        async run()
        {
            if (_storedValue('tah.clickToOpen', 'client') === true)
                await game.settings.set(MODULE_ID, 'tah.openMode', 'click');
        },
    },
    {
        id: 'overSpeedMode_v1',
        async run()
        {
            const stored = _storedValue('enableBoostOffer');
            if (stored === 'yes' || stored === 'auto' || stored === true)
                return;

            const next = _storedValue('enableMovementCapDetection') === true ? 'stop' : 'off';
            if (stored !== undefined || next !== 'off')
                await game.settings.set(MODULE_ID, 'enableBoostOffer', next);
        },
    },
    {
        id: 'terrainElevationMode_v1',
        async run()
        {
            if (_storedValue('disableAutoTerrainElevation') === true)
                await game.settings.set(MODULE_ID, 'terrainElevationMode', 'off');
            else if (_storedValue('disableAutoElevationOnMeasure') === true)
                await game.settings.set(MODULE_ID, 'terrainElevationMode', 'move');
        },
    },
    {
        id: 'dragVisionFull_v1',
        async run()
        {
            const stored = _storedValue('dragVisionMode');
            if ((stored ?? 'ratio') !== 'ratio')
                return;
            if (Number(_storedValue('dragVisionMultiplier') ?? 1) < 1)
                await game.settings.set(MODULE_ID, 'dragVisionMode', 'ratio');
            else if (stored !== undefined)
                await game.settings.set(MODULE_ID, 'dragVisionMode', 'full');
        },
    },
    {
        id: 'wreckAudioVolume_v1',
        scope: 'client',
        async run()
        {
            if (_storedValue('enableWreckAudio', 'client') === false)
                await game.settings.set(MODULE_ID, 'wreckMasterVolume', 0);
        },
    },
    {
        id: 'attackTargetingMode_v1',
        async run()
        {
            if (!_priorInstall())
                return;

            let mode = 'auto';
            if ((_storedValue('enableAttackTargeting') ?? true) === false)
                mode = 'off';
            else if ((_storedValue('autoStartTargetPicking') ?? false) === false)
                mode = 'picker';
            await game.settings.set(MODULE_ID, 'attackTargeting', mode);
        },
    },
    {
        id: 'scanRevealMode_v1',
        async run()
        {
            if (!_priorInstall())
                return;

            let mode = 'nobody';
            if (_storedValue('revealStatsWithoutScan') === true)
                mode = 'everyone';
            else if ((_storedValue('scanRevealAllies') ?? false) === true)
                mode = 'allies';
            else if ((_storedValue('scanRevealPlayers') ?? true) === true)
                mode = 'players';
            await game.settings.set(MODULE_ID, 'scanRevealMode', mode);
        },
    },
    {
        id: 'statHintPlacement_v1',
        scope: 'client',
        async run()
        {
            if (!_priorInstall())
                return;

            let placement = 'token';
            if (_storedValue('tokenStatHintDocked', 'client') === true)
                placement = 'docked';
            else if (_storedValue('tokenStatHintScaleWithZoom') === true)
                placement = 'zoom';
            await game.settings.set(MODULE_ID, 'tokenStatHintPlacement', placement);
        },
    },
    {
        id: 'autoFocusMaster_v1',
        scope: 'client',
        async run()
        {
            const kinds = ['autoFocusCards', 'autoFocusAttack', 'autoFocusDamage', 'autoFocusCheck', 'autoFocusActivation'];
            if (kinds.some(key => _storedValue(key, 'client') === true))
                await game.settings.set(MODULE_ID, 'autoFocusEnabled', true);
        },
    },
    {
        id: 'hudScaleShared_v1',
        scope: 'client',
        async run()
        {
            const hud = _storedValue('tah.uiScale', 'client');
            const toolbar = _storedValue('advMeasureScale', 'client');

            if ((hud === undefined || Number(hud) === 1) && toolbar !== undefined && Number(toolbar) !== 1)
                await game.settings.set(MODULE_ID, 'tah.uiScale', Number(toolbar));
        },
    },
    {
        id: 'pinOldDefaultsWorld_v1',
        async run()
        {
            await _pinOldDefaults('world');
        },
    },
    {
        id: 'pinOldDefaultsClient_v1',
        scope: 'client',
        async run()
        {
            await _pinOldDefaults('client');
        },
    },
    {
        id: 'tahPortraitPerType_v1',
        scope: 'client',
        async run()
        {
            const mode = _storedValue('tah.portrait.mode', 'client');
            const scope = _storedValue('tah.portrait.scope', 'client');

            if (mode === undefined && scope === undefined)
                return;

            const shared = mode ?? 'token';
            const others = (scope ?? 'all') === 'mechPilot' ? 'off' : shared;
            const values = { mech: shared, pilot: shared, npc: others, deployable: others };
            for (const [type, value] of Object.entries(values))
                await game.settings.set(MODULE_ID, `tah.portrait.${type}`, value);

            const reviewed = getModuleSetting('reviewedDefaultKeys') ?? [];
            if (reviewed.includes('tah.portrait.mode') || reviewed.includes('tah.portrait.scope'))
                await game.settings.set(MODULE_ID, 'reviewedDefaultKeys', [...new Set([...reviewed, ...Object.keys(values).map(type => `tah.portrait.${type}`)])]);
        },
    },
];

Hooks.once('init', () =>
{
    for (const m of MIGRATIONS)
    {
        game.settings.register(MODULE_ID, m.id, {
            scope: /** @type {any} */ (m.scope ?? 'world'),
            config: false,
            type: Boolean,
            default: false,
        });
    }

    game.settings.register(MODULE_ID, SETTING_INSTALL_STATE, { scope: 'world', config: false, type: String, default: '' });
});

Hooks.once('ready', async () =>
{
    const executor = isExecutorGM();
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    if (executor && !getModuleSetting(SETTING_INSTALL_STATE))
        await game.settings.set(MODULE_ID, SETTING_INSTALL_STATE, isFreshWorld() ? 'fresh' : 'prior');

    for (const m of MIGRATIONS)
    {
        if ((m.scope ?? 'world') === 'world' && !executor)
            continue;
        if (getModuleSetting(m.id))
            continue;

        try
        {
            await m.run();
        }
        catch (e)
        {
            console.error(`lancer-automations | migration "${m.id}" failed`, e);
            continue;
        }

        await game.settings.set(MODULE_ID, m.id, true);
    }

    _resolveMigrations();
});

export { _storedValue as storedSettingValue };
