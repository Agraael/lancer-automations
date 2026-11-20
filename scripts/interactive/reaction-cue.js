import { createTokenMark } from "./target-shapes.js";
import { TG } from "./canvas-palette.js";
import { MODULE_ID } from "../tools/constants.js";
import { getExternalSetting } from "../tools/settings-utils.js";
import { playUiSound } from "../tah/sound.js";

const CHANNEL = `module.${MODULE_ID}`;
const _cues = new Map();

const cueKey = (originId, relatedId) => `${originId}|${relatedId ?? ''}`;

function seenByMe(token)
{
    return !!token && !token.destroyed && (game.user.isGM || token.visible);
}

function pingReactor(token)
{
    const controls = canvas.controls;
    if (!controls)
        return;

    const position = token.center;
    const types = /** @type {any} */ (CONFIG.Canvas.pings.types);
    const style = getExternalSetting('core', 'photosensitiveMode') ? types.PULL : types.PULSE;
    controls.drawPing(position, { style, color: TG.cardOrigin });
    playUiSound('locateToken');
    if (canvas.isOffscreen(position))
        controls.drawOffscreenPing(position, { style: types.ARROW, color: TG.cardOrigin });
}

function addSender(originId, relatedId, userId)
{
    const key = cueKey(originId, relatedId);
    let cue = _cues.get(key);

    if (!cue)
    {
        const origin = canvas.tokens?.get(originId);
        const related = relatedId ? canvas.tokens?.get(relatedId) : null;
        cue = { senders: new Map(), marks: [] };
        _cues.set(key, cue);

        if (seenByMe(related))
            cue.marks.push(createTokenMark(related, TG.cardRelated, { broadcast: false }));

        if (seenByMe(origin))
        {
            cue.marks.push(createTokenMark(origin, TG.cardOrigin, { broadcast: false }));
            pingReactor(origin);
        }
    }

    cue.senders.set(userId, (cue.senders.get(userId) ?? 0) + 1);
}

function dropCue(key, cue)
{
    cue.marks.forEach(mark => mark.destroy());
    _cues.delete(key);
}

function removeSender(originId, relatedId, userId)
{
    const key = cueKey(originId, relatedId);
    const cue = _cues.get(key);

    if (!cue)
        return;

    const count = (cue.senders.get(userId) ?? 0) - 1;
    if (count > 0)
        cue.senders.set(userId, count);
    else
        cue.senders.delete(userId);

    if (!cue.senders.size)
        dropCue(key, cue);
}

/**
 * @param {Token} originToken
 * @param {Token|null} relatedToken
 * @returns {{ end: () => void } | null}
 */
export function startReactionCue(originToken, relatedToken)
{
    const origin = originToken?.id ? canvas.tokens?.get(originToken.id) : null;
    const related = relatedToken?.id ? canvas.tokens?.get(relatedToken.id) : null;

    if (!origin || !canvas.scene)
        return null;

    const relatedId = related && related.id !== origin.id ? related.id : null;
    const payload = { sceneId: canvas.scene.id, originId: origin.id, relatedId, userId: game.user.id };
    addSender(origin.id, relatedId, game.user.id);
    game.socket.emit(CHANNEL, { action: 'reactionCue', payload: { ...payload, active: true } });

    let ended = false;
    return {
        end()
        {
            if (ended)
                return;
            ended = true;
            removeSender(origin.id, relatedId, game.user.id);
            game.socket.emit(CHANNEL, { action: 'reactionCue', payload: { ...payload, active: false } });
        }
    };
}

export function onRemoteReactionCue(payload)
{
    if (!payload || payload.userId === game.user.id || payload.sceneId !== canvas.scene?.id)
        return;

    if (payload.active)
        addSender(payload.originId, payload.relatedId, payload.userId);
    else
        removeSender(payload.originId, payload.relatedId, payload.userId);
}

Hooks.on('canvasTearDown', () =>
{
    for (const [key, cue] of _cues)
        dropCue(key, cue);
});

Hooks.on('userConnected', (user, connected) =>
{
    if (connected)
        return;

    for (const [key, cue] of _cues)
    {
        cue.senders.delete(user.id);
        if (!cue.senders.size)
            dropCue(key, cue);
    }
});
