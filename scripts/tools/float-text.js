export function floatTokenText(token, text, fill)
{
    if (!token?.center || !text)
        return;
    try
    {
        if (!game.settings.get('lancer', 'floatingNumbers'))
            return;
    }
    catch (_)
    {
        return;
    }
    canvas.interface?.createScrollingText(token.center, text, {
        anchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
        direction: CONST.TEXT_ANCHOR_POINTS.TOP,
        fontSize: 28,
        fill,
        stroke: 0,
        strokeThickness: 4,
        jitter: 0.25
    });
}

export function broadcastFloatTokenText(token, text, fill)
{
    if (!token?.id)
        return;
    game.socket.emit('module.lancer-automations', {
        action: 'floatTokenText',
        payload: { tokenId: token.id, text, fill }
    });
    floatTokenText(token, text, fill);
}
