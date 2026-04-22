/* global game, foundry */

let _lastSoundAt = 0;

/**
 * Play a TAH UI sound. Gated by `tah.uiSoundVolume` setting (0 = silent).
 * @param {'hover'|'open'|'details'|'toggle'|'statusHover'} [variant='open']
 */
export function playUiSound(variant = 'open') {
    let vol = 0;
    try { vol = Number(game.settings.get('lancer-automations', 'tah.uiSoundVolume')) || 0; } catch { /* not ready */ }
    if (vol <= 0) return;
    const now = Date.now();
    const minGap = variant === 'hover' ? 60 : 60;
    if (now - _lastSoundAt < minGap) return;
    _lastSoundAt = now;
    const SFX = {
        hover:       { src: 'modules/lancer-automations/SFX/ui-hover-item_3.wav',       scale: 0.3 },
        open:        { src: 'modules/lancer-automations/SFX/ui-hover-item_3.wav',       scale: 0.3 },
        statusHover: { src: 'modules/lancer-automations/SFX/ui-hover-item.wav',       scale: 0.1 },
        details:     { src: 'modules/lancer-automations/SFX/ui-rightclick-item_2.wav',  scale: 2 },
        toggle:      { src: 'modules/lancer-automations/SFX/ui-toggle-item_2.wav',      scale: 2 },
    };
    const { src, scale } = SFX[variant] ?? SFX.open;
    // Very thin continuous pitch jitter: ±30 cents (roughly ±1.7%).
    const cents = (Math.random() * 2 - 1) * 30;
    const rate = Math.pow(2, cents / 1200);
    Promise.resolve(foundry.audio.AudioHelper.play(/** @type {any} */ ({ src, volume: vol * scale, autoplay: true, loop: false }), false)).then(/** @param {any} sound */ sound => {
        try {
            if (sound?.element)
                sound.element.playbackRate = rate;
            else if (sound?.sourceNode?.playbackRate)
                sound.sourceNode.playbackRate.value = rate;
        } catch { /* ignore */ }
    }).catch(() => { /* ignore */ });
}
