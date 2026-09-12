/* global game, globalThis, Hooks */

import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { isExecutorGM } from '../tools/misc-tools.js';

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
