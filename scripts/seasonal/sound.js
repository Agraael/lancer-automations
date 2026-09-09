const MODULE = 'lancer-automations';
const BASE = 'modules/lancer-automations/FX/audio/Mmmmmm';
const VOLUME_SETTING = 'seasonalVolume';

const SOUNDS = {
    pop:   { src: `${BASE}/pop-gun.wav`, scale: 0.8 },
    boing: { srcs: [1, 2, 3, 4].map(index => `${BASE}/boing_0${index}.wav`), scale: 0.7 },
};

/**
 * Play a seasonal sound. `srcs` entries pick one file at random.
 * @param {'pop'|'boing'} variant
 * @param {{volumeScale?: number}} [opts]
 */
export function playSeasonalSound(variant, { volumeScale = 1 } = {})
{
    const entry = SOUNDS[variant];
    if (!entry)
        return;
    let vol = 0;
    try
    {
        vol = Number(game.settings.get(MODULE, VOLUME_SETTING)) || 0;
    }
    catch
    {
        return;
    }
    if (vol <= 0)
        return;
    const src = entry.srcs ? entry.srcs[Math.floor(Math.random() * entry.srcs.length)] : entry.src;
    foundry.audio.AudioHelper.play(
        /** @type {any} */ ({ src, volume: vol * entry.scale * volumeScale, autoplay: true, loop: false }),
        false
    );
}

Hooks.once('setup', () =>
{
    game.settings.register(MODULE, VOLUME_SETTING, {
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1, step: 0.05 },
    });
});
