/* global game, globalThis, Hooks */

const MODULE = 'lancer-automations';

const MIGRATIONS = [
    {
        id: 'tah.scopeMigration_clientToWorld_v1',
        run() {
            const keys = ['tah.showDisposition', 'tah.auraDefaultThreat', 'tah.auraDefaultSensor', 'tah.auraDefaultRange'];
            for (const key of keys) {
                try {
                    const raw = globalThis.localStorage.getItem(`${MODULE}.${key}`);
                    if (raw === null)
                        continue;
                    const value = JSON.parse(raw);
                    const def = game.settings.settings.get(`${MODULE}.${key}`)?.default;
                    if (value === def)
                        continue;
                    game.settings.set(MODULE, key, value);
                } catch { /* ignore */ }
            }
        },
    },
];

Hooks.once('init', () => {
    for (const m of MIGRATIONS) {
        game.settings.register(MODULE, m.id, {
            scope: 'world',
            config: false,
            type: Boolean,
            default: false,
        });
    }
});

Hooks.once('ready', async () => {
    if (!game.user.isGM)
        return;
    for (const m of MIGRATIONS) {
        if (game.settings.get(MODULE, m.id))
            continue;
        try {
            await m.run();
        } catch (e) {
            console.error(`LA migration "${m.id}" failed`, e);
            continue;
        }
        await game.settings.set(MODULE, m.id, true);
    }
});
