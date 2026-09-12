// Uplink mirror card: a miniature of the real roll HUDs. Structure, classes,
// and CSS values are lifted from the system's AccDiffHUD / DamageHUD styles.

const COVER_LABELS = ['No Cover', 'Soft (-1)', 'Hard (-2)'];
const COVER_ICONS = ['mdi mdi-shield-outline', 'mdi mdi-shield-half-full', 'mdi mdi-shield'];
const QUALITY_LABELS = ['Miss', 'Hit', 'Crit'];
const QUALITY_ICONS = ['mdi mdi-call-missed', 'fas fa-crosshairs', 'fas fa-explosion'];
const KIND_LABELS = { attack: 'Attack', tech: 'Tech Attack', damage: 'Damage', hase: 'Check' };
const HEAD_META = {
    attack: { cls: 'lancer-weapon', icon: 'cci cci-weapon' },
    tech: { cls: 'lancer-tech', icon: 'cci cci-tech-quick' },
    damage: { cls: 'lancer-weapon', icon: 'cci cci-large-beam' },
    hase: { cls: 'lancer-weapon', icon: 'fas fa-dice-d20' }
};
const DMG_ICONS = { kinetic: 'cci-kinetic', energy: 'cci-energy', explosive: 'cci-explosive', heat: 'cci-heat', burn: 'cci-burn', variable: 'cci-variable', infection: 'cci-infection' };
const RANGE_ICONS = { range: 'cci-range', threat: 'cci-threat', thrown: 'cci-thrown', blast: 'cci-blast', burst: 'cci-burst', cone: 'cci-cone', line: 'cci-line' };

function esc(text)
{
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

function checkbox(label, checked, disabled = false)
{
    return `<label class="lau-chk${checked ? ' on' : ''}${disabled ? ' dis' : ''}"><i></i><span>${esc(label)}</span></label>`;
}

function radioRow(labels, activeIdx, icons = null)
{
    const parts = labels.map((label, idx) =>
    {
        const icon = icons?.[idx] ? `<i class="${icons[idx]} lau-rad-i"></i>` : '';
        return `<span class="lau-rad${icon ? ' has-i' : ''}${idx === Number(activeIdx) ? ' on' : ''}">${icon}${esc(label)}</span>`;
    });
    return `<div class="lau-radrow">${parts.join('')}</div>`;
}

function signed(num)
{
    const amount = Number(num) || 0;
    return amount >= 0 ? `+${amount}` : `${amount}`;
}

function totalBadge(total)
{
    const amount = Number(total) || 0;
    const icon = amount >= 0 ? 'cci-accuracy' : 'cci-difficulty';
    return `<span class="lau-tot"><b>${Math.abs(amount)}</b><i class="cci ${icon} i--s" style="border:none"></i></span>`;
}

function sectionHeader(icon, label)
{
    const iconHtml = icon ? `<i class="${icon} i--s" style="border:none"></i>` : '';
    return `<h4 class="lau-h4 lancer-border-primary">${iconHtml}<span>${esc(label)}</span></h4>`;
}

function damageLine(list)
{
    return (list || []).map(entry =>
    {
        const type = String(entry.type || '').toLowerCase();
        const icon = DMG_ICONS[type];
        const iconHtml = icon ? `<i class="cci ${icon} damage--${esc(type)} i--s" style="border:none"></i>` : '';
        return `<div class="lau-dmg">${iconHtml}<span>${esc(`${entry.val} ${entry.type}`)}</span></div>`;
    }).join('');
}

function targetingRow(snapshot)
{
    const rangeEntries = Object.entries(snapshot.ranges || {});
    const damageEntries = snapshot.kind === 'damage'
        ? [...(snapshot.raw.weapon?.damage || []), ...(snapshot.raw.weapon?.bonusDamage || [])]
        : snapshot.attackDamage || [];
    if (!rangeEntries.length && !damageEntries.length)
        return '';
    const chips = rangeEntries.map(([type, rangeVal]) =>
    {
        const icon = RANGE_ICONS[String(type).toLowerCase()];
        const iconHtml = icon ? `<i class="cci ${icon} i--s" style="border:none"></i>` : '';
        return `<span class="lau-range" data-hover-range="${Number(rangeVal) || 0}">${iconHtml}<span>${esc(icon ? rangeVal : `${type} ${rangeVal}`)}</span></span>`;
    }).join('');
    const baseEntries = snapshot.kind === 'damage' ? [] : (snapshot.attackDamageBase || []);
    const baseChanged = baseEntries.length > 0 && JSON.stringify(baseEntries) !== JSON.stringify(snapshot.attackDamage || []);
    const baseHtml = baseChanged
        ? `<span style="color:#777;font-size:0.85em;margin-left:4px;">(base: ${esc(baseEntries.map(entry => `${entry.val} ${entry.type}`).join(' + '))})</span>`
        : '';
    const bonusEntries = snapshot.kind === 'damage' ? [] : (snapshot.attackBonusDamage || []);
    const bonusHtml = bonusEntries.length
        ? `<span style="opacity:0.7;margin:0 2px;">+</span>${damageLine(bonusEntries)}`
        : '';
    return `<div class="lau-radrow"><b class="lau-tglabel">Targeting</b>${chips}${damageLine(damageEntries)}${baseHtml}${bonusHtml}</div>`;
}

function miniHeader(snapshot, uuid)
{
    const target = snapshot.targets?.find(entry => entry.uuid === uuid);
    const img = target?.img ? `<img class="lau-timg" src="${esc(target.img)}" alt="" onerror="this.remove()">` : '';
    return `<span class="lancer-mini-header lau-mini" data-hover-tgt="${esc(uuid)}">${img}<span>🞂&nbsp;${esc(target?.name || 'Unknown')}&nbsp;🞀</span></span>`;
}

function accDiffBody(snapshot)
{
    const raw = snapshot.raw;
    const rows = [];
    const weapon = raw.weapon || {};

    // Same render gates as the system HUD: Thrown only for melee weapons, Engaged
    // hidden on tech attacks, Impaired always shown but disabled (actor status).
    const isHase = snapshot.kind === 'hase';
    const laRows = snapshot.laRows || {};
    const accColumn = [
        checkbox('Accurate (+1)', weapon.accurate),
        checkbox('Smart (*)', weapon.smart)
    ];
    if (!isHase)
        accColumn.push(checkbox('Seeking (*)', weapon.seeking));
    const diffColumn = [
        checkbox('Inaccurate (-1)', weapon.inaccurate),
        checkbox('Impaired (-1)', weapon.impaired, true)
    ];
    if (!isHase && weapon.melee && !weapon.tech)
        diffColumn.push(checkbox('Thrown (*)', weapon.thrown));
    if (!isHase && !weapon.tech)
        diffColumn.push(checkbox('Engaged (-1)', weapon.engaged));
    for (const row of laRows.global?.acc || [])
        accColumn.push(checkbox(row.label, row.on));
    for (const row of laRows.global?.diff || [])
        diffColumn.push(checkbox(row.label, row.on));
    rows.push(`<div class="lau-cols">
        <div class="lau-col">${sectionHeader('cci cci-accuracy', 'Accuracy')}${accColumn.join('')}</div>
        <div class="lau-col">${sectionHeader('cci cci-difficulty', 'Difficulty')}${diffColumn.join('')}</div>
    </div>`);

    const base = raw.base || {};
    const adjust = (Number(base.accuracy) || 0) - (Number(base.difficulty) || 0);
    const grit = Number(isHase ? snapshot.statBonus : base.grit) || 0;
    const flat = Number(isHase ? laRows.flat : base.flatBonus) || 0;
    rows.push(`<label class="lau-flatlabel lancer-border-primary">Flat Modifier</label>`);
    rows.push(`<div class="lau-flat">
        <span><b>${isHase ? 'Base' : 'Grit'}</b> ${signed(grit)}</span>
        <span><b>Flat</b> ${signed(flat)}</span>
        <span><b>Total</b> ${signed(grit + flat)}</span>
        <span><b>Adj</b> ${signed(adjust)}</span>
        ${(raw.targets || []).length === 0 ? `<span>${totalBadge(snapshot.totals?.base)}</span>` : ''}
    </div>`);
    if (laRows.modifiers?.length)
        rows.push(`<div class="lau-chiprow lau-lamods">${laRows.modifiers.map(row => checkbox(row.label, row.on)).join('')}</div>`);
    rows.push(targetingRow(snapshot));

    if ((raw.targets || []).length)
    {
        const cards = raw.targets.map(target =>
        {
            const total = snapshot.totals?.targets?.find(entry => entry.uuid === target.targetUuid)?.total;
            const chips = [];
            if (target.lockOn)
                chips.push(checkbox('Lock On (+1)', true));
            if (target.prone)
                chips.push(checkbox('Prone (+1)', true));
            if (target.stunned)
                chips.push(checkbox('Stunned', true));
            if (target.invisible)
                chips.push(checkbox('Invisible (*)', true));
            for (const row of laRows.targets?.[target.targetUuid] || [])
                chips.push(checkbox(row.label, row.on));
            const modifiers = [];
            if (target.accuracy)
                modifiers.push(`Acc +${target.accuracy}`);
            if (target.difficulty)
                modifiers.push(`Diff +${target.difficulty}`);
            return `<div class="lau-tcard">
                ${miniHeader(snapshot, target.targetUuid)}
                ${isHase ? '' : radioRow(COVER_LABELS, target.cover, COVER_ICONS)}
                ${chips.length ? `<div class="lau-chiprow">${chips.join('')}</div>` : ''}
                <div class="lau-trow">
                    ${modifiers.length ? `<span class="lau-tmods">${modifiers.join(' · ')}</span>` : ''}
                    <span class="lau-tot"><span class="lau-totlabel">Total</span>${totalBadge(total)}</span>
                </div>
            </div>`;
        }).join('');
        rows.push(`<div class="lau-tgrid">${cards}</div>`);
    }

    if (snapshot.contest)
        rows.push(`<div class="lau-flat"><span><b>vs</b> ${esc(snapshot.contest.name || '?')} · ${esc(String(snapshot.contest.stat || '').toUpperCase())}</span></div>`);
    else if (snapshot.check && (snapshot.check.targetName || snapshot.check.targetVal !== null))
        rows.push(`<div class="lau-flat"><span>${snapshot.check.targetName ? `<b>vs</b> ${esc(snapshot.check.targetName)} · ` : ''}<b>DC</b> ${esc(snapshot.check.targetVal ?? 10)}</span></div>`);

    return rows.join('');
}

// The damage HUD hides the rows LA syncs in for its enabled bonuses, so the
// mirror drops one matching entry per synced damage part.
function withoutSynced(list, laRows)
{
    const synced = (laRows || []).filter(row => row.on).flatMap(row => row.damage || []);
    return (list || []).filter(entry =>
    {
        const idx = synced.findIndex(part => String(part.type).toLowerCase() === String(entry.type).toLowerCase() && String(part.val) === String(entry.val));
        if (idx < 0)
            return true;
        synced.splice(idx, 1);
        return false;
    });
}

function laDamageRow(row)
{
    return `<div class="lau-larow">${checkbox(row.label, row.on)}${damageLine(row.damage)}</div>`;
}

function damageBody(snapshot)
{
    const raw = snapshot.raw;
    const rows = [];
    const weapon = raw.weapon || {};
    const base = raw.base || {};
    const laRows = snapshot.laRows || {};
    const bonusDamage = withoutSynced([...(weapon.bonusDamage || []), ...(base.bonusDamage || [])], laRows.global);

    rows.push(`<div class="lau-cols">
        <div class="lau-col">${sectionHeader('', 'Base Damage')}${damageLine(weapon.damage) || '<div class="lau-dmg">none</div>'}</div>
        <div class="lau-col">${sectionHeader('', 'Bonus Damage')}${damageLine(bonusDamage) || '<div class="lau-dmg">none</div>'}</div>
    </div>`);

    rows.push(sectionHeader('', 'Configuration'));
    const config = [
        checkbox('Overkill', weapon.overkill),
        checkbox(weapon.reliable ? `Reliable ${weapon.reliableValue}` : 'Reliable', weapon.reliable)
    ];
    const laConfig = snapshot.la || {};
    if (laConfig.knockback)
        config.push(checkbox(laConfig.knockback.enabled ? `Knockback ${laConfig.knockback.value || 1}` : 'Knockback', laConfig.knockback.enabled));
    if (laConfig.noBonusDmg)
        config.push(checkbox('No Bonus Dmg', laConfig.noBonusDmg.enabled));
    if (laConfig.throttled)
        config.push(checkbox('Throttled (Half Dmg)', laConfig.throttled.enabled));
    rows.push(`<div class="lau-chiprow">${config.join('')}</div>`);
    if (laRows.global?.length)
        rows.push(`${sectionHeader('', 'Global Bonuses')}<div class="lau-larows">${laRows.global.map(laDamageRow).join('')}</div>`);
    rows.push(targetingRow(snapshot));

    if ((raw.targets || []).length)
    {
        const cards = raw.targets.map((target, index) =>
        {
            const laTarget = laRows.targets?.[index] || [];
            return `<div class="lau-tcard">
            ${miniHeader(snapshot, target.targetUuid)}
            ${radioRow(QUALITY_LABELS, target.quality, QUALITY_ICONS)}
            <div class="lau-chiprow">${checkbox('AP', target.ap)}${checkbox('1/2', target.halfDamage)}${checkbox('No Reduce', target.paracausal)}</div>
            ${laTarget.length ? `<div class="lau-larows">${laTarget.map(laDamageRow).join('')}</div>` : ''}
            ${damageLine(withoutSynced(target.bonusDamage, laTarget))}
        </div>`;
        }).join('');
        rows.push(`<div class="lau-tgrid">${cards}</div>`);
    }

    return rows.join('');
}

/**
 * Build one read-only mirror card element from a recorded snapshot.
 * @param {any} snapshot
 * @returns {HTMLElement}
 */
export function buildMirrorCard(snapshot)
{
    const title = snapshot.title || snapshot.itemName || (snapshot.kind === 'hase' ? snapshot.checkLabel : '') || KIND_LABELS[snapshot.kind] || 'Roll';
    const head = HEAD_META[snapshot.kind] || HEAD_META.hase;
    const body = snapshot.kind === 'damage' ? damageBody(snapshot) : accDiffBody(snapshot);

    let iconHtml = `<i class="${head.icon} i--m i--light"></i>`;
    if (snapshot.weaponIcon)
    {
        const url = esc(foundry.utils.getRoute(snapshot.weaponIcon));
        iconHtml = `<i class="lau-wicon" style="-webkit-mask-image:url('${url}');mask-image:url('${url}')"></i>`;
    }

    const card = document.createElement('div');
    card.className = `lau-card lancer-hud lau-${snapshot.kind}`;
    card.innerHTML = `
        <div class="lau-head lancer-header medium ${head.cls}">
            ${iconHtml}
            <span class="lau-title"><span class="lau-title-text">${esc(title)}</span></span>
            <span class="lau-who">${snapshot.actorImg ? `<img class="lau-who-img" src="${esc(snapshot.actorImg)}" alt=""${snapshot.rollerTokenUuid ? ` data-pan-uuid="${esc(snapshot.rollerTokenUuid)}"` : ''} onerror="this.remove()">` : ''}${esc(snapshot.user || snapshot.actorName)}</span>
        </div>
        <div class="lau-hud-body">${body}</div>`;
    return card;
}
