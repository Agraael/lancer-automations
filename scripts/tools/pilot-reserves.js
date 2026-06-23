function _resolvePilot(tokenOrActor) {
    const actor = tokenOrActor?.actor ?? tokenOrActor;
    if (!actor)
        return null;
    if (actor.type === 'pilot')
        return actor;
    if (actor.type === 'mech')
        return actor.system?.pilot?.value ?? null;
    return null;
}

const _ORG_TYPES = ['Military', 'Scientific', 'Academic', 'Criminal', 'Humanitarian', 'Industrial', 'Entertainment', 'Political'];
const _PROJECT_REQS = ['Quality materials', 'Specific knowledge or techniques', 'Specialized tools', 'A good workspace'];

async function _fetchReservesByType() {
    const map = { Bonus: [], Resources: [], Tactical: [], Mech: [] };
    const RESOURCE_NAMES = new Set([
        'Access', 'Backing', 'Supplies', 'Disguise', 'Diversion', 'Blackmail',
        'Reputation', 'Safe Harbor', 'Tracking', 'Knowledge', 'Golden Ticket',
        'Stash Of Private Moonshine', "Governor's Farm Advanced Access",
        "Fielding's Workshop Access", 'Patience Hookup', 'Causality Fragment',
    ]);
    const normalize = (t, name) => {
        if (!t)
            return null;
        if (t === 'Resource' || RESOURCE_NAMES.has(name))
            return 'Resources';
        return t;
    };
    for (const pack of game.packs) {
        if (pack.documentName !== 'Item')
            continue;
        const index = await pack.getIndex({ fields: ['system.lid', 'system.type', 'system.description', 'type'] });
        for (const e of index) {
            if (e.type !== 'reserve')
                continue;
            const rawType = e.system?.type;
            const t = normalize(rawType, e.name);
            if (t && map[t])
                map[t].push({ name: e.name, lid: e.system?.lid ?? '', desc: e.system?.description ?? '', uuid: e.uuid });
        }
    }
    for (const arr of Object.values(map)) {
        arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
}

export async function openAddReserveDialog(tokenOrActor) {
    const pilot = _resolvePilot(tokenOrActor);
    if (!pilot) {
        ui.notifications.warn('Select a pilot or mech token.'); return;
    }

    const reserveMap = await _fetchReservesByType();

    const TABS = [
        { key: 'bonus',    label: 'Pilot Bonuses' },
        { key: 'resource', label: 'Resource' },
        { key: 'tactical', label: 'Tactical' },
        { key: 'mech',     label: 'Mech' },
        { key: 'custom',   label: 'Custom' },
        { key: 'project',  label: 'Project' },
        { key: 'org',      label: 'Organization' },
    ];
    const tabNav = TABS.map((t, i) =>
        `<a class="la-rtab${i === 0 ? ' active' : ''}" data-tab="${t.key}" style="padding:4px 6px;font-size:0.78em;white-space:nowrap;cursor:pointer;text-align:center;border:1px solid #999;border-radius:3px;background:${i === 0 ? 'var(--primary-color)' : '#eee'};color:${i === 0 ? '#fff' : '#333'};user-select:none;">${t.label}</a>`
    ).join('');

    const buildList = (items) => items.map(r => {
        const shortDesc = r.desc.replace(/<[^>]+>/g, '').slice(0, 80);
        return `<div class="la-reserve-row" data-uuid="${r.uuid}" style="padding:5px 8px;border-bottom:1px solid rgba(0,0,0,0.08);cursor:pointer;display:flex !important;flex-direction:row !important;align-items:center;gap:6px;">
            <div style="flex:1;min-width:0;overflow:hidden;">
                <div style="font-weight:bold;font-size:0.88em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.name}</div>
                ${shortDesc ? `<div style="font-size:0.72em;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${shortDesc}</div>` : ''}
            </div>
            <a class="la-add-btn" data-uuid="${r.uuid}" style="flex-shrink:0;padding:2px 8px;font-size:0.78em;cursor:pointer;border:1px solid #999;border-radius:3px;background:#eee;color:#333;"><i class="fas fa-plus"></i></a>
        </div>`;
    }).join('') || '<div style="padding:20px;text-align:center;color:#888;">No items found.</div>';

    const orgOpts = _ORG_TYPES.map(t => `<option value="${t}">${t}</option>`).join('');
    const reqCbs = _PROJECT_REQS.map(r => `<label style="display:flex;align-items:center;gap:4px;font-size:0.82em;"><input type="checkbox" class="proj-req" value="${r}"> ${r}</label>`).join('');
    const subtypeBtns = ['Resources', 'Mech', 'Tactical'].map((t, i) => `<a class="la-subtype-btn${i === 0 ? ' active' : ''}" data-val="${t}" style="flex:1;padding:3px;font-size:0.8em;text-align:center;cursor:pointer;border:1px solid #999;border-radius:3px;background:${i === 0 ? 'var(--primary-color)' : '#eee'};color:${i === 0 ? '#fff' : '#333'};user-select:none;">${t}</a>`).join('');

    const BODY = `
        <div class="lancer-dialog-header" style="margin:-8px -8px 8px -8px;">
            <h1 class="lancer-dialog-title" style="font-size:1em;">Reserves & Bonuses</h1>
            <p class="lancer-dialog-subtitle" style="font-size:0.78em;">${pilot.name}</p>
        </div>
        <nav style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:6px;">${tabNav}</nav>
        <div style="height:340px;overflow-y:auto;" id="la-reserve-body">
            <div class="la-rtab-content" data-tab="bonus">${buildList(reserveMap.Bonus)}</div>
            <div class="la-rtab-content" data-tab="resource" style="display:none;">${buildList(reserveMap.Resources)}</div>
            <div class="la-rtab-content" data-tab="tactical" style="display:none;">${buildList(reserveMap.Tactical)}</div>
            <div class="la-rtab-content" data-tab="mech" style="display:none;">${buildList(reserveMap.Mech)}</div>
            <div class="la-rtab-content" data-tab="custom" style="display:none;">
                <div style="display:flex;gap:2px;margin-bottom:6px;">${subtypeBtns}</div>
                <div class="form-group"><label style="font-size:0.85em;">Resource Name</label><input type="text" id="cr-name" placeholder="Name"></div>
                <div class="form-group"><label style="font-size:0.85em;">Details</label><textarea id="cr-desc" rows="2" style="width:100%;" placeholder="Details"></textarea></div>
                <button type="button" id="cr-add" style="width:100%;margin-top:4px;"><i class="fas fa-plus"></i> Add Reserve</button>
            </div>
            <div class="la-rtab-content" data-tab="project" style="display:none;">
                <div class="form-group"><label style="font-size:0.85em;">Project Name</label><input type="text" id="pj-name" placeholder="Name"></div>
                <div class="form-group"><label style="font-size:0.85em;">Details</label><textarea id="pj-desc" rows="2" style="width:100%;" placeholder="Details"></textarea></div>
                <div style="display:flex;gap:10px;margin:4px 0;">
                    <label style="display:flex;align-items:center;gap:3px;font-size:0.82em;"><input type="checkbox" id="pj-complicated"> Complicated</label>
                    <label style="display:flex;align-items:center;gap:3px;font-size:0.82em;"><input type="checkbox" id="pj-finished"> Finished</label>
                </div>
                <div class="form-group"><label style="font-size:0.85em;">Requirements</label>${reqCbs}</div>
                <div class="form-group"><label style="font-size:0.85em;">Other</label><input type="text" id="pj-custom-req" placeholder="Custom requirement"></div>
                <button type="button" id="pj-add" style="width:100%;margin-top:4px;"><i class="fas fa-plus"></i> Add Project</button>
            </div>
            <div class="la-rtab-content" data-tab="org" style="display:none;">
                <div class="form-group"><label style="font-size:0.85em;">Name</label><input type="text" id="org-name" placeholder="Organization Name"></div>
                <div class="form-group"><label style="font-size:0.85em;">Type</label><select id="org-type">${orgOpts}</select></div>
                <div class="form-group"><label style="font-size:0.85em;">Description</label><textarea id="org-desc" rows="2" style="width:100%;" placeholder="Purpose / Goal"></textarea></div>
                <div class="form-group"><label style="font-size:0.85em;">Start with</label>
                    <div style="display:flex;gap:3px;">
                        <a class="la-org-start active" data-val="efficiency" style="flex:1;padding:4px;font-size:0.82em;text-align:center;cursor:pointer;border:1px solid #999;border-radius:3px;background:var(--primary-color);color:#fff;user-select:none;">Efficiency (+2)</a>
                        <a class="la-org-start" data-val="influence" style="flex:1;padding:4px;font-size:0.82em;text-align:center;cursor:pointer;border:1px solid #999;border-radius:3px;background:#eee;color:#333;user-select:none;">Influence (+2)</a>
                    </div>
                </div>
                <button type="button" id="org-add" style="width:100%;margin-top:4px;"><i class="fas fa-plus"></i> Add Organization</button>
            </div>
        </div>`;

    new Dialog({
        title: `Reserves — ${pilot.name}`,
        content: BODY,
        buttons: { close: { label: 'Close' } },
        render: (html) => {
            html.find('.la-rtab').on('click', function () {
                html.find('.la-rtab').removeClass('active').css({ background: '#eee', color: '#333' });
                $(this).addClass('active').css({ background: 'var(--primary-color)', color: '#fff' });
                html.find('.la-rtab-content').hide();
                html.find(`.la-rtab-content[data-tab="${$(this).data('tab')}"]`).show();
                html.find('#la-reserve-body').scrollTop(0);
            });
            html.find('.la-subtype-btn').on('click', function () {
                html.find('.la-subtype-btn').removeClass('active').css({ background: '#eee', color: '#333' });
                $(this).addClass('active').css({ background: 'var(--primary-color)', color: '#fff' });
            });
            html.find('.la-org-start').on('click', function () {
                html.find('.la-org-start').removeClass('active').css({ background: '#eee', color: '#333' });
                $(this).addClass('active').css({ background: 'var(--primary-color)', color: '#fff' });
            });

            html.on('click', '.la-add-btn', async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const uuid = $(ev.currentTarget).data('uuid');
                const doc = await fromUuid(uuid);
                if (!doc)
                    return;
                const data = doc.toObject(); delete data._id;
                await pilot.createEmbeddedDocuments('Item', [data]);
                ui.notifications.info(`Added "${doc.name}" to ${pilot.name}.`);
            });
            html.find('#cr-add').on('click', async () => {
                const name = String(html.find('#cr-name').val()).trim();
                if (!name) {
                    ui.notifications.warn('Enter a name.'); return;
                }
                await pilot.createEmbeddedDocuments('Item', [{ name,
                    type: 'reserve',
                    img: 'systems/lancer/assets/icons/reserve_tac.svg',
                    system: { lid: 'reserve_custom', type: html.find('.la-subtype-btn.active').data('val') || 'Resources', description: String(html.find('#cr-desc').val()), consumable: true, used: false } }]);
                ui.notifications.info(`Added "${name}" to ${pilot.name}.`);
            });
            html.find('#pj-add').on('click', async () => {
                const name = String(html.find('#pj-name').val()).trim();
                if (!name) {
                    ui.notifications.warn('Enter a name.'); return;
                }
                const finished = html.find('#pj-finished').is(':checked');
                const reqs = []; html.find('.proj-req:checked').each(function () {
                    reqs.push($(this).val());
                });
                const cr = String(html.find('#pj-custom-req').val()).trim(); if (cr)
                    reqs.push(cr);
                let desc = String(html.find('#pj-desc').val());
                if (html.find('#pj-complicated').is(':checked'))
                    desc += '\n<b>Complicated</b>';
                if (!finished && reqs.length)
                    desc += `\nRequires: ${reqs.join(', ')}`;
                await pilot.createEmbeddedDocuments('Item', [{ name: finished ? name : `${name} (In Progress)`,
                    type: 'reserve',
                    img: 'systems/lancer/assets/icons/reserve_tac.svg',
                    system: { lid: 'reserve_project', type: 'Project', label: 'Project', description: desc, consumable: false, used: false } }]);
                ui.notifications.info(`Added project "${name}" to ${pilot.name}.`);
            });
            html.find('#org-add').on('click', async () => {
                const name = String(html.find('#org-name').val()).trim();
                if (!name) {
                    ui.notifications.warn('Enter a name.'); return;
                }
                const s = html.find('.la-org-start.active').data('val') || 'efficiency';
                await pilot.createEmbeddedDocuments('Item', [{ name,
                    type: 'organization',
                    img: 'systems/lancer/assets/icons/encounter.svg',
                    system: { purpose: html.find('#org-type').val(), description: String(html.find('#org-desc').val()), efficiency: s === 'efficiency' ? 2 : 0, influence: s === 'influence' ? 2 : 0, actions: '' } }]);
                ui.notifications.info(`Added "${name}" to ${pilot.name}.`);
            });
        }
    }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 520, height: 520, resizable: false }).render(true);
}
