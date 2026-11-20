import { getLAFlag } from '../tools/flag-utils.js';

function actorFromRef(ref)
{
    const id = typeof ref === 'string' ? ref : ref?.id ?? null;
    if (!id)
        return null;

    const doc = fromUuidSync(id) ?? game.actors?.get(id) ?? null;
    return doc?.actor ?? doc ?? null;
}

function tokenOnScene(actor, sceneId)
{
    return (actor?.getActiveTokens?.() ?? []).find(candidate => (candidate.document?.parent?.id ?? candidate.scene?.id) === sceneId) ?? null;
}

function asToken(tokenOrActor)
{
    if (tokenOrActor?.document)
        return tokenOrActor;
    if (tokenOrActor?.object)
        return tokenOrActor.object;

    const actor = tokenOrActor?.actor ?? tokenOrActor;
    return actor?.token?.object ?? actor?.getActiveTokens?.()?.[0] ?? null;
}

export function deployableOwnerActor(tokenOrDoc)
{
    const doc = tokenOrDoc?.document ?? tokenOrDoc;
    if (!doc)
        return null;

    const linked = getLAFlag(doc, 'ownerActorUuid');
    if (linked)
        return actorFromRef(linked);
    if (getLAFlag(doc, 'ownerUnlinked'))
        return null;
    return actorFromRef(doc.actor?.system?.owner);
}

export function deployableOwnerToken(tokenOrActor)
{
    const token = asToken(tokenOrActor);
    if (token?.actor?.type !== 'deployable')
        return null;

    const owner = deployableOwnerActor(token);
    if (!owner)
        return null;

    const sceneId = token.document?.parent?.id ?? canvas.scene?.id;
    return tokenOnScene(owner, sceneId) ?? tokenOnScene(owner.system?.active_mech?.value, sceneId);
}

export function deployablesOf(ownerTokenIds)
{
    const owners = new Set(ownerTokenIds);
    return (canvas.tokens?.placeables ?? []).filter(token => token.actor?.type === 'deployable' && owners.has(deployableOwnerToken(token)?.document?.id));
}

let _ownsActions = null;
let _ownMoveCap = null;

export function registerOwnActions(resolver)
{
    _ownsActions = resolver;
}

export function registerOwnMove(resolver)
{
    _ownMoveCap = resolver;
}

export function ownMoveCapOf(tokenOrDoc)
{
    const token = asToken(tokenOrDoc);
    return token?.actor?.type === 'deployable' ? (_ownMoveCap?.(token) ?? null) : null;
}

export function tapeToken(tokenOrActor)
{
    return deployableOwnerToken(tokenOrActor) ?? tokenOrActor;
}

export function billingToken(tokenOrActor)
{
    const owner = deployableOwnerToken(tokenOrActor);
    if (!owner || _ownsActions?.(asToken(tokenOrActor)))
        return tokenOrActor;
    return owner;
}

export function billingActor(tokenOrActor)
{
    const target = billingToken(tokenOrActor);
    return target?.actor ?? target;
}

export function fightsThroughOwner(token)
{
    const owner = deployableOwnerToken(token);
    return !!owner?.inCombat && !!game.combat?.started;
}

export function movesOnItsOwn(tokenOrDoc)
{
    const token = asToken(tokenOrDoc);
    return ownMoveCapOf(token) != null && fightsThroughOwner(token);
}
