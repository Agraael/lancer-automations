/* global game, globalThis, Hooks */

import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { isExecutorGM } from '../tools/misc-tools.js';
import { normalizeBonusShape } from '../bonuses/genericBonuses.js';

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
                    for (const reaction of (Array.isArray(entry?.reactions) ? entry.reactions : [entry]))
                    {
                        if (!Array.isArray(reaction?.triggers) || !reaction.triggers.includes('onInvoluntaryMove'))
                            continue;
                        reaction.triggers = reaction.triggers.map(trigger => (trigger === 'onInvoluntaryMove' ? 'onPreInvoluntaryMove' : trigger));
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
        async run()
        {
            const keys = ['global_bonuses', 'constant_bonuses', 'ephemeral_bonuses', 'bonusTemplates'];
            const reshape = (entry, key) => (key === 'bonusTemplates' && entry?.bonusData
                ? { ...entry, bonusData: normalizeBonusShape(entry.bonusData) }
                : normalizeBonusShape(entry));
            const migrateDoc = async (doc) =>
            {
                for (const key of keys)
                {
                    const list = doc?.getFlag?.(MODULE_ID, key);
                    if (!Array.isArray(list))
                        continue;
                    const next = list.map(entry => reshape(entry, key));
                    const changed = next.some((entry, index) => (key === 'bonusTemplates'
                        ? entry.bonusData !== list[index]?.bonusData
                        : entry !== list[index]));
                    if (changed)
                        await doc.setFlag(MODULE_ID, key, next);
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
];

Hooks.once('init', () =>
{
    for (const m of MIGRATIONS)
    {
        game.settings.register(MODULE_ID, m.id, {
            scope: 'world',
            config: false,
            type: Boolean,
            default: false,
        });
    }
});

Hooks.once('ready', async () =>
{
    if (!isExecutorGM())
        return;
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    for (const m of MIGRATIONS)
    {
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
});
