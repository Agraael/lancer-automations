/** Duration-origin value meaning "every target is its own reference". */
export const EACH_ORIGIN = '__each';

/** Split a target field value into ids. Multi-target fields hold a comma-joined list. */
export function _emTargetIds(targetID)
{
    return String(targetID ?? '').split(',').map(id => id.trim()).filter(Boolean);
}

/** One apply call per token when each target is its own duration reference, otherwise one for all. */
export function _emApplyGroups(tokens, originID)
{
    if (originID !== EACH_ORIGIN)
        return [{ tokens, origin: originID }];
    return tokens.map(token => ({ tokens: [token], origin: token.id }));
}

/** Notification label for a resolved target list. */
export function _emTargetLabel(docs)
{
    if (docs.length > 3)
        return `${docs.length} tokens`;
    return docs.map(doc => doc.name).join(', ');
}

/** Resolve every id in a target field value. */
export function _resolveEmTargets(targetID)
{
    return _emTargetIds(targetID).map(id => _resolveEmTarget(id));
}

/**
 * Point a target `<select>` at one or more ids, adding a synthetic option for a multi-token set.
 * @param {any} $select
 * @param {string[]} ids
 */
export function _setEmTargetValue($select, ids)
{
    const el = $select[0];
    if (!el)
        return;
    const value = ids.join(', ');
    if (el.tagName === 'SELECT')
    {
        $select.find('option.em-multi-opt').remove();
        if (ids.length > 1)
            $select.prepend(`<option class="em-multi-opt" value="${value}">${ids.length} tokens</option>`);
    }
    $select.val(value).change();
}

/** Resolve a dropdown targetID to `{actor, token, item}`. targetID can be a scene tokenId or an actor/item UUID. */
export function _resolveEmTarget(targetID)
{
    if (typeof targetID === 'string' && targetID.includes(','))
        targetID = _emTargetIds(targetID)[0];
    if (!targetID)
        return { actor: null, token: null, item: null };
    if (typeof targetID === 'string' && targetID.includes('.'))
    {
        const doc = /** @type {any} */ (fromUuidSync(targetID));
        if (doc?.documentName === 'Item')
            return { actor: doc, token: null, item: doc };
        return { actor: doc?.documentName === 'Actor' ? doc : null, token: null, item: null };
    }
    const token = canvas.tokens.get(targetID);
    return { actor: token?.actor ?? null, token: token ?? null, item: null };
}
