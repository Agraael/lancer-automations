/* global game, foundry */

let _lastSoundAt = 0;

/**
 * Play a TAH UI sound. Gated by `tah.uiSoundVolume` setting (0 = silent).
 * @param {'hover'|'open'|'details'|'toggle'} [variant='open']
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
        hover:   { src: 'modules/lancer-automations/SFX/ui-hover-item_2.wav',       scale: 0.5 },
        open:    { src: 'modules/lancer-automations/SFX/ui-hover-item_2.wav',       scale: 0.5 },
        details: { src: 'modules/lancer-automations/SFX/ui-rightclick-item_2.wav', scale: 2 },
        toggle:  { src: 'modules/lancer-automations/SFX/ui-toggle-item_2.wav',    scale: 2 },
    };
    const { src, scale } = SFX[variant] ?? SFX.open;
    foundry.audio.AudioHelper.play({ src, volume: vol * scale, autoplay: true, loop: false }, false);
}
