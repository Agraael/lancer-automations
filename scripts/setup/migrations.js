/* global game, globalThis, Hooks */

const MODULE = 'lancer-automations';

const MIGRATIONS = [
    {
        // keep pre-4.0 Overwatch notify on for worlds that never saved a choice
        id: 'overwatchDefaultFlip_v1',
        async run()
        {
            const priorInstall = game.settings.storage.get('world')?.contents
                ?.some(setting => setting.key?.startsWith(`${MODULE}.`));
            if (!priorInstall)
                return;
            const saved = game.settings.get(MODULE, 'generalReactions') || {};
            if (saved.Overwatch?.reactions?.some(sub => sub?.enabled !== undefined))
                return;
            saved.Overwatch = { ...saved.Overwatch, reactions: [{ enabled: true }] };
            await game.settings.set(MODULE, 'generalReactions', saved);
            Hooks.callAll('lancer-automations.clearCaches');
        },
    },
    {
        id: 'visionRangeScrub_v1',
        async run()
        {
            if (!game.settings.get(MODULE, 'lancerVisionAutoAdd'))
                return;
            await globalThis.lancerAutoVisionSetup?.();
        },
    },
    {
        id: 'lancerLosModes_v1',
        async run()
        {
            if (!game.settings.get(MODULE, 'lancerVisionAutoAdd'))
                return;
            await globalThis.lancerAutoVisionSetup?.();
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
                    const raw = globalThis.localStorage.getItem(`${MODULE}.${key}`);
                    if (raw === null)
                        continue;
                    const value = JSON.parse(raw);
                    const def = game.settings.settings.get(`${MODULE}.${key}`)?.default;
                    if (value === def)
                        continue;
                    game.settings.set(MODULE, key, value);
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
        game.settings.register(MODULE, m.id, {
            scope: 'world',
            config: false,
            type: Boolean,
            default: false,
        });
    }
});

Hooks.once('ready', async () =>
{
    if (!game.user.isGM)
        return;
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    for (const m of MIGRATIONS)
    {
        if (game.settings.get(MODULE, m.id))
            continue;
        try
        {
            await m.run();
        }
        catch (e)
        {
            console.error(`LA migration "${m.id}" failed`, e);
            continue;
        }
        await game.settings.set(MODULE, m.id, true);
    }
});
