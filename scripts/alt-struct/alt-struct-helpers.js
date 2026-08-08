// Push an alt-struct flow button (anchor) onto state.data.embedButtons.
// attrs holds any extra data-* pairs (e.g. { 'check-type': 'hull', 'rem-struct': 3 }).
export function pushEmbedButton(state, { flowType, actorUuid, icon, label, attrs = {} })
{
    state.data.embedButtons = state.data.embedButtons || [];
    const extra = Object.entries(attrs)
        .map(([name, value]) => `data-${name}="${value}"`)
        .join(' ');
    state.data.embedButtons.push(
        `<a class="alt-struct-flow-button lancer-button" data-flow-type="${flowType}" ${extra} data-actor-id="${actorUuid}">`
        + `<i class="${icon} i--sm"></i> ${label}</a>`
    );
}
