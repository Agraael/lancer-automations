// Shared segmented T1|T2|T3 tier-gate control. Blank = Any. Reused across every LA link dialog.

function _pillStyle(tier, active)
{
    const base = 'display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:17px;padding:0 4px;font-size:0.7em;font-weight:bold;border:1px solid #555;cursor:pointer;user-select:none;';
    const radius = tier === 1 ? 'border-radius:3px 0 0 3px;' : tier === 3 ? 'border-radius:0 3px 3px 0;border-left:none;' : 'border-left:none;';
    const skin = active ? 'background:#c8641e;border-color:#e0821e;color:#fff;' : 'background:rgba(255,255,255,0.05);color:#999;';
    return base + radius + skin;
}

// True where a tier can ever matter: NPC actor, NPC-owned item, or unowned item. Mech/pilot/deployable get no pills.
export function tierGateApplies(target)
{
    if (!target)
        return false;
    const doc = target.documentName ? target : (target.actor ?? target.document ?? target);
    if (doc.documentName === 'Item')
    {
        const owner = doc.parent;
        return !owner || owner.type === 'npc';
    }
    return doc.type === 'npc';
}

export function tierGateControl(currentTier = null, dataAttrs = '')
{
    const cur = Number(currentTier) || 0;
    const pill = (tier) => `<span class="la-tier-pill" data-tier="${tier}" title="Only on a Tier ${tier} NPC owner" style="${_pillStyle(tier, cur === tier)}">T${tier}</span>`;
    return `<span class="la-tier-gate" data-tier="${cur || ''}" ${dataAttrs} title="Gate to an NPC tier (blank = any tier / non-NPC)" style="display:inline-flex;vertical-align:middle;">${pill(1)}${pill(2)}${pill(3)}</span>`;
}

export function readTierGate(gate)
{
    const el = gate?.jquery ? gate[0] : gate;
    const raw = Number(el?.getAttribute?.('data-tier')) || 0;
    return raw > 0 ? raw : null;
}

// $root is a jQuery element. onChange(tier|null, gateDomElement) fires on each pill click.
export function bindTierGate($root, onChange)
{
    $root.find('.la-tier-gate .la-tier-pill').on('click', function ()
    {
        const gate = this.closest('.la-tier-gate');
        if (!gate)
            return;
        const clicked = Number(this.getAttribute('data-tier')) || 0;
        const cur = Number(gate.getAttribute('data-tier')) || 0;
        const next = clicked === cur ? 0 : clicked;
        gate.setAttribute('data-tier', next ? String(next) : '');
        gate.querySelectorAll('.la-tier-pill').forEach(node =>
        {
            const tier = Number(node.getAttribute('data-tier')) || 0;
            node.setAttribute('style', _pillStyle(tier, tier === next));
        });
        onChange?.(next > 0 ? next : null, gate);
    });
}
