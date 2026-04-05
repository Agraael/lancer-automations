/**
 * Infection Damage Type
 *
 * Adds "Infection" as a new damage type to Lancer, fully external.
 * Infection works like Burn but applies Heat instead of damage.
 *
 * Rules:
 *   - When characters take Infection, they immediately take equal Heat
 *     and mark the Infection value.
 *   - Additional Infection stacks.
 *   - End of turn: roll Systems check (≥10 success clears all Infection,
 *     fail = take Heat equal to Infection marked).
 *   - Stabilize and Full Repair also clear Infection.
 */

const MODULE_ID = 'lancer-automations';

// Pending infection for preCreateChatMessage to modify the "took X damage" message
let _pendingInfection = null;

// ---------------------------------------------------------------------------
// 1. Schema injection — add system.infection field to actor data models
// ---------------------------------------------------------------------------

/** Inject `infection` NumberField into mech and NPC actor schemas. Call during `init`. */
export function injectInfectionSchemaField() {
    const NumberField = foundry.data.fields.NumberField;
    const actorKeys = ['mech', 'npc'];
    let injected = 0;
    for (const key of actorKeys) {
        const model = CONFIG.Actor.dataModels?.[key];
        if (!model?.schema?.fields)
            continue;
        if (!model.schema.fields.infection) {
            try {
                model.schema.fields.infection = new NumberField({ initial: 0, integer: true, min: 0 });
                injected++;
            } catch (e) {
                console.warn(`${MODULE_ID} | Could not inject infection field into ${key} actor:`, e);
            }
        }
    }
    if (injected)
        console.log(`${MODULE_ID} | Injected infection field into ${injected} actor schema(s)`);
}

// ---------------------------------------------------------------------------
// 2. DamageField choices injection — add "Infection" to damage type selectors
// ---------------------------------------------------------------------------

/**
 * Add "Infection" to DamageType enum and all DamageField choices.
 * Patches via ESM live bindings (propagates to all importers including the damage HUD).
 * Call during `init`.
 */
export async function injectInfectionDamageType() {
    // Patch DamageType enum via dynamic import of the hashed bundle
    try {
        const entryResp = await fetch('/systems/lancer/lancer.mjs');
        const entryText = await entryResp.text();
        const match = entryText.match(/import\s+["']\.\/([^"']+)["']/);
        if (match) {
            const bundleName = match[1];
            const bundle = await import(`/systems/lancer/${bundleName}`);
            if (bundle.D && !bundle.D.Infection) {
                bundle.D.Infection = "Infection";
                console.log(`${MODULE_ID} | Added "Infection" to DamageType enum via bundle export`);
            }
        }
    } catch (e) {
        console.warn(`${MODULE_ID} | Could not patch DamageType enum:`, e);
    }

    // Patch DamageField choices in item schemas
    let patched = 0;

    function traverseFields(fields) {
        if (!fields)
            return;
        for (const field of Object.values(fields)) {
            if (field.fields)
                traverseFields(field.fields);
            if (field.element) {
                if (field.element.fields)
                    traverseFields(field.element.fields);
                if (field.element.element?.fields)
                    traverseFields(field.element.element.fields);
            }
            if (field instanceof foundry.data.fields.StringField &&
                Array.isArray(field.choices) &&
                field.choices.includes('Kinetic') &&
                !field.choices.includes('Infection')) {
                field.choices.push('Infection');
                patched++;
            }
        }
    }

    for (const model of Object.values(CONFIG.Item.dataModels ?? {})) {
        if (model?.schema?.fields)
            traverseFields(model.schema.fields);
    }

    if (patched)
        console.log(`${MODULE_ID} | Added "Infection" to ${patched} DamageField choice list(s)`);
}

// ---------------------------------------------------------------------------
// 3. CSS injection — icon and damage color
// ---------------------------------------------------------------------------

export function injectInfectionCSS() {
    if (document.getElementById('la-infection-css'))
        return;
    const style = document.createElement('style');
    style.id = 'la-infection-css';
    style.textContent = `
        /* Infection damage type icon — SVG inline, matched to CCI font glyph sizing */
        .cci-infection::before {
            content: "";
            display: inline-block;
            width: 1em;
            height: 1em;
            background: url("modules/lancer-automations/icons/infection.svg") center/contain no-repeat;
            vertical-align: -0.15em;
            /* Default: white — matches all other CCI damage icons */
            filter: brightness(0) invert(1);
        }
        .damage--infection {
            color: #1a8a3a;
        }
        /* Green tint: actor sheet weapon damage display (has i--dark + damage-- class), and damage HUD */
        i.i--dark.damage--infection.cci-infection::before,
        .damage-hud .cci-infection::before,
        #damage-hud .cci-infection::before {
            filter: brightness(0) saturate(100%) invert(45%) sepia(60%) saturate(500%) hue-rotate(80deg) brightness(0.9);
        }
    `;
    document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// 4. InfectionFlow — end-of-turn infection check
// ---------------------------------------------------------------------------

/** Init infection check data — mirrors initBurnCheckData but uses Heat + system.infection. */
async function initInfectionCheckData(state) {
    if (!state.data)
        throw new TypeError('Infection flow state missing!');

    const infection = state.actor?.system?.infection ?? 0;
    if (infection <= 0)
        return false;

    state.data.amount = infection;
    state.data.damage = [{ type: "Heat", val: infection.toString() }];

    const tokens = state.actor.getActiveTokens();
    if (!tokens?.length) {
        ui.notifications?.error("Infection flow requires the actor to have a token in the scene");
        return false;
    }

    const target = tokens[0];
    state.data.hit_results = [{ target, total: "10", usedLockOn: false, hit: true, crit: false }];

    // Manual damage_hud_data (matches DamageHudData.fromParams output)
    state.data.damage_hud_data = {
        base: {
            total: {
                damage: state.data.damage,
                bonusDamage: []
            },
            ap: false,
            paracausal: true,   // Infection heat cannot be resisted
            halfDamage: false,
        },
        weapon: {
            overkill: false,
            reliable: false,
            reliableValue: 0,
        },
        targets: [{
            target,
            bonusDamage: [],
            halfDamage: false,
            quality: 1, // Hit
        }]
    };

    state.data.bonus_damage = [];
    state.data.damage_results = [];
    state.data.crit_damage_results = [];
    state.data.reliable_results = [];
    state.data.targets = [];
    return true;
}

/** Roll a SYS check for infection (mirrors rollBurnCheck). */
async function rollInfectionCheck(state) {
    if (!state.data)
        throw new TypeError('Infection flow state missing!');

    const StatRollFlow = game.lancer?.flows?.get('StatRollFlow');
    if (!StatRollFlow || typeof StatRollFlow !== 'function') {
        ui.notifications?.error('Could not find StatRollFlow for infection check.');
        return false;
    }

    const rollFlow = new StatRollFlow(state.actor.uuid, { title: 'INFECTION :: SYS', path: 'system.sys' });
    const success = await rollFlow.begin();

    state.data.check_total = rollFlow.state?.data?.result?.roll?.total;

    if (game.dice3d) {
        const msg = game.messages?.contents?.[game.messages.contents.length - 1];
        if (msg)
            await game.dice3d.waitFor3DAnimationByMessageID(msg.id);
    }

    return success && state.data.check_total !== undefined && state.data.check_total !== null;
}

/** Check infection result: >= 10 clears, < 10 calls rollNormalDamage for heat. */
async function checkInfectionResult(state) {
    if (!state.data)
        throw new TypeError('Infection flow state missing!');
    if (!state.data.check_total)
        throw new TypeError('Infection check not rolled!');

    if (state.data.check_total >= 10) {
        // Success — clear infection
        state.data.title = "INFECTION CLEARED!";
        state.data.icon = "mdi mdi-shield-check";
        await state.actor.update({ 'system.infection': 0 });
        return true;
    }

    // Failure — apply heat via rollNormalDamage
    const rollNormalDamage = game.lancer?.flowSteps?.get('rollNormalDamage');
    if (!rollNormalDamage || typeof rollNormalDamage !== 'function') {
        throw new TypeError("Couldn't get rollNormalDamage flow step!");
    }
    return await rollNormalDamage(state);
}

// ---------------------------------------------------------------------------
// 5. Turn-end trigger — hook into combat turn changes
// ---------------------------------------------------------------------------

function onUpdateCombatInfection(combat, change, _options, _userId) {
    if (!('turn' in change) && change.round !== 1)
        return;
    if (!combat.combatants?.contents?.length)
        return;

    // Actor whose turn just ended
    const prevActor = combat.previous?.combatantId
        ? combat.combatants.get(combat.previous.combatantId)?.actor
        : null;
    if (!prevActor)
        return;

    const infection = prevActor.system?.infection ?? 0;
    if (infection <= 0)
        return;

    if (!prevActor.isOwner)
        return;

    _triggerInfectionFlow(prevActor);
}

function _triggerInfectionFlow(actor) {
    const flowDef = game.lancer?.flows?.get('InfectionFlow');
    if (!flowDef)
        return;

    const FlowBase = _getFlowBase();
    if (!FlowBase)
        return;

    const GenericFlow = class extends FlowBase {
        constructor(uuid, data) {
            super(uuid, data || {});
        }
    };
    GenericFlow.steps = flowDef.steps;

    new GenericFlow(actor.uuid, {
        type: "damage",
        title: "Infection Heat",
        icon: "cci cci-infection",
        damage: [{ type: "Heat", val: "1" }],  // Will be overwritten by initInfectionCheckData
        configurable: false,
        add_burn: false,
        tags: [],
        ap: false,
        paracausal: true,
        half_damage: false,
        overkill: false,
        reliable: false,
        hit_results: [],
        has_normal_hit: true,
        has_crit_hit: false,
        damage_results: [],
        crit_damage_results: [],
        damage_total: 0,
        crit_total: 0,
        targets: []
    }).begin();
}

function _getFlowBase() {
    const StatRollFlow = game.lancer?.flows?.get('StatRollFlow');
    return typeof StatRollFlow === 'function' ? Object.getPrototypeOf(StatRollFlow) : null;
}

// ---------------------------------------------------------------------------
// 6. Stabilize / Full Repair — clear infection
// ---------------------------------------------------------------------------

async function clearInfectionOnStabilize(state) {
    if (!state.actor)
        return true;
    const infection = state.actor.system?.infection ?? 0;
    if (infection > 0) {
        await state.actor.update({ 'system.infection': 0 });
        ui.notifications.info(`${state.actor.name}: Infection cleared by stabilize.`);
    }
    return true;
}

async function clearInfectionOnRepair(state) {
    if (!state.actor)
        return true;
    const infection = state.actor.system?.infection ?? 0;
    if (infection > 0) {
        await state.actor.update({ 'system.infection': 0 });
    }
    return true;
}

// ---------------------------------------------------------------------------
// 7. Flow + hook registration
// ---------------------------------------------------------------------------

export function registerInfectionFlows(flowSteps, flows) {
    flowSteps.set('lancer-automations:initInfectionCheckData', initInfectionCheckData);
    flowSteps.set('lancer-automations:rollInfectionCheck', rollInfectionCheck);
    flowSteps.set('lancer-automations:checkInfectionResult', checkInfectionResult);
    flowSteps.set('lancer-automations:clearInfectionOnStabilize', clearInfectionOnStabilize);
    flowSteps.set('lancer-automations:clearInfectionOnRepair', clearInfectionOnRepair);

    // Mirrors BurnFlow steps; printDamageCard is the system's built-in renderer
    flows.set('InfectionFlow', {
        name: 'Infection Check',
        steps: [
            'lancer-automations:initInfectionCheckData',
            'lancer-automations:rollInfectionCheck',
            'lancer-automations:checkInfectionResult',
            'printDamageCard',
        ]
    });

    // Clear infection on stabilize/repair
    flows.get('StabilizeFlow')?.insertStepAfter('printStabilizeResult', 'lancer-automations:clearInfectionOnStabilize');
    flows.get('FullRepairFlow')?.insertStepAfter('executeFullRepair', 'lancer-automations:clearInfectionOnRepair');
}

export function initInfectionHooks() {
    // Inject infection into the resistances object (prepareBaseData rebuilds it from scratch)
    if (typeof libWrapper !== 'undefined') {
        libWrapper.register(MODULE_ID, 'CONFIG.Actor.documentClass.prototype.prepareBaseData',
            function (wrapped) {
                wrapped();
                if (this.system?.resistances && !('infection' in this.system.resistances)) {
                    this.system.resistances.infection = false;
                }
            }, 'WRAPPER');
    }

    Hooks.on('updateCombat', onUpdateCombatInfection);

    // Modify "took X damage" messages to show infection
    Hooks.on('preCreateChatMessage', (msg) => {
        if (!_pendingInfection)
            return;
        let content = msg.content;
        if (!content?.includes('damage!') || !content?.includes('lancer-damage-undo'))
            return;

        const inf = _pendingInfection;
        const infStr = `${inf.amount}<i class="cci cci-infection damage--infection i--s"></i>`;

        if (content.includes('took 0') || content.match(/took\s+damage!/)) {
            content = content.replace(/took 0\s*damage!|took\s+damage!/, `took ${infStr} infection!`);
        } else {
            content = content.replace(/damage!/, `damage + ${infStr} infection!`);
        }

        // Patch undo button's heat-delta to include infection heat
        content = content.replace(
            /data-heat-delta="(\d+)"/,
            (match, existing) => `data-heat-delta="${parseInt(existing) + inf.amount}" data-infection-delta="${inf.amount}"`
        );

        msg.updateSource({ content });
    });

    // Wrap damageCalc — AppliedDamage doesn't handle Infection natively,
    // so we intercept via click handlers and apply infection manually
    if (typeof libWrapper !== 'undefined') {
        libWrapper.register(MODULE_ID, 'CONFIG.Actor.documentClass.prototype.damageCalc',
            async function (wrapped, damage, options) {
                await wrapped(damage, options);
            }, 'WRAPPER');

        // Pre-intercept: capture infection data BEFORE system's jQuery handler
        document.getElementById('chat-log')?.addEventListener('click', (ev) => {
            const button = ev.target?.closest?.('.lancer-damage-apply');
            if (!button)
                return;
            const chatMessageElement = button.closest('.chat-message.message');
            if (!chatMessageElement)
                return;
            const chatMessage = game.messages?.get(chatMessageElement.dataset.messageId);
            const damageData = chatMessage?.flags?.lancer?.damageData;
            if (!damageData)
                return;
            const buttonGroup = button.closest('.lancer-damage-button-group');
            const targetUuid = buttonGroup?.dataset?.target;
            if (!targetUuid)
                return;
            const targetResult = damageData.targetDamageResults?.find(tdr => tdr.target === targetUuid);
            if (!targetResult)
                return;
            const infectionDmg = targetResult.damage?.filter(d => d.type === 'Infection')?.reduce((sum, d) => sum + (d.amount ?? 0), 0) ?? 0;
            if (infectionDmg <= 0)
                return;
            const multipleSelect = buttonGroup.querySelector('select');
            let multiple = multipleSelect ? parseFloat(multipleSelect.value) : 1;
            if (Number.isNaN(multiple))
                multiple = 1;
            _pendingInfection = { actorUuid: targetResult.target, amount: Math.ceil(infectionDmg * multiple) };
        }, { capture: true });

        // Post-intercept: apply infection AFTER system's damageCalc
        document.getElementById('chat-log')?.addEventListener('click', async (ev) => {
            const button = ev.target?.closest?.('.lancer-damage-apply');
            if (!button)
                return;

            const chatMessageElement = button.closest('.chat-message.message');
            if (!chatMessageElement)
                return;

            const chatMessage = game.messages?.get(chatMessageElement.dataset.messageId);
            const damageData = chatMessage?.flags?.lancer?.damageData;
            if (!damageData)
                return;

            const buttonGroup = button.closest('.lancer-damage-button-group');
            const targetUuid = buttonGroup?.dataset?.target;
            if (!targetUuid)
                return;

            const targetResult = damageData.targetDamageResults?.find(tdr => tdr.target === targetUuid);
            if (!targetResult)
                return;

            const infectionDmg = targetResult.damage
                ?.filter(d => d.type === 'Infection')
                ?.reduce((sum, d) => sum + (d.amount ?? 0), 0) ?? 0;

            if (infectionDmg <= 0)
                return;

            const multipleSelect = buttonGroup.querySelector('select');
            let multiple = multipleSelect ? parseFloat(multipleSelect.value) : 1;
            if (Number.isNaN(multiple))
                multiple = 1;

            const scaledInfection = Math.ceil(infectionDmg * multiple);

            const target = await fromUuid(targetUuid);
            const actor = target?.actor;
            if (!actor?.isOwner)
                return;

            // setTimeout ensures this runs after the system's jQuery click handler
            setTimeout(async () => {
                const resistant = actor.system?.resistances?.infection;
                const finalInfection = resistant ? Math.ceil(scaledInfection / 2) : scaledInfection;

                const currentInfection = actor.system?.infection ?? 0;
                const updates = { 'system.infection': currentInfection + finalInfection };
                if (actor.hasHeatcap?.()) {
                    updates['system.heat.value'] = actor.system.heat.value + finalInfection;
                }
                await actor.update(updates);
                _pendingInfection = null;
            }, 100);
        }, { capture: false });

        // Undo infection (our .la-infection-undo or system's .lancer-damage-undo with data-infection-delta)
        document.getElementById('chat-log')?.addEventListener('click', async (ev) => {
            const button = ev.target?.closest?.('.la-infection-undo, .lancer-damage-undo[data-infection-delta]');
            if (!button)
                return;

            const infectionDelta = parseInt(button.dataset.infectionDelta) || 0;
            if (!infectionDelta)
                return;

            const uuid = button.dataset.uuid;
            if (!uuid)
                return;

            const actor = fromUuidSync(uuid);
            if (!actor?.isOwner)
                return;

            const currentInfection = actor.system?.infection ?? 0;
            await actor.update({ 'system.infection': Math.max(currentInfection - infectionDelta, 0) });
            // Heat undo handled by the system's own handler via data-heat-delta
        });

        // Apply Heat button (infection turn-end failure card)
        document.getElementById('chat-log')?.addEventListener('click', async (ev) => {
            const button = ev.target?.closest?.('.la-infection-apply');
            if (!button)
                return;

            const uuid = button.dataset.uuid;
            const heat = parseInt(button.dataset.heat) || 0;
            if (!uuid || !heat)
                return;

            const actor = fromUuidSync(uuid);
            if (!actor?.isOwner)
                return;

            if (actor.hasHeatcap?.()) {
                await actor.update({ 'system.heat.value': actor.system.heat.value + heat });
            }

            // Swap to undo button
            button.style.display = 'none';
            const undoBtn = button.parentElement?.querySelector('.la-infection-undo');
            if (undoBtn) {
                undoBtn.style.display = '';
                undoBtn.dataset.heatDelta = String(heat);
            }

            const tokenName = actor.token?.name ?? actor.name;
            ui.notifications.info(`${tokenName} took ${heat} Heat from Infection.`);
        });

        console.log(`${MODULE_ID} | Wrapped damageCalc for Infection handling`);
    }

    console.log(`${MODULE_ID} | Infection hooks initialized`);
}

// ---------------------------------------------------------------------------
// 8. API for applying infection from external sources (reactions, macros, etc.)
// ---------------------------------------------------------------------------

/** Apply infection to an actor: immediately take heat + mark infection. */
export async function applyInfection(actor, amount) {
    if (!actor || amount <= 0)
        return;
    const currentInfection = actor.system?.infection ?? 0;
    const currentHeat = actor.system?.heat?.value ?? 0;

    await actor.update({
        'system.infection': currentInfection + amount,
        'system.heat.value': currentHeat + amount,
    });

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `
            <div class="card clipped-bot" style="margin:0">
                <div class="lancer-header lancer-primary" style="padding:4px 8px;">
                    <i class="cci cci-infection i--m"></i> INFECTION
                </div>
                <div class="effect-text" style="padding:4px 8px;">
                    ${actor.name} takes <b>${amount} Heat</b> from Infection and marks <b>${amount} Infection</b>.
                    (Total: ${currentInfection + amount})
                </div>
            </div>`
    });
}

// ---------------------------------------------------------------------------
// 9. Sheet display — inject infection stat card next to burn on actor sheets
// ---------------------------------------------------------------------------

/** Inject infection stat card next to BURN on actor sheets. */
export function onRenderActorSheetInfection(app, html, _data) {
    const jHtml = html instanceof $ ? html : $(html);
    const actor = app.actor ?? app.document;
    if (!actor)
        return;

    if (!actor.is_mech?.() && !actor.is_npc?.())
        return;

    if (jHtml.find('.la-infection-stat').length || jHtml.find('.la-infection-alt').length)
        return;

    const infection = actor.system?.infection ?? 0;

    // Base Lancer sheet
    const $burnCard = jHtml.find('input[name="system.burn"]').closest('.card.clipped');
    if ($burnCard.length) {
        _injectInfectionBaseSheet(jHtml, $burnCard, actor, infection);
        return;
    }

    // Alternative sheet
    const $altBurnInput = jHtml.find('input[name="system.burn"]');
    if ($altBurnInput.length) {
        _injectInfectionAltSheet(jHtml, $altBurnInput, actor, infection);
        return;
    }
}

function _injectInfectionBaseSheet(jHtml, $burnCard, actor, infection) {

    const actorUuid = actor.uuid;

    const infectionCard = `
    <div class="card clipped la-infection-stat">
      <div class="lancer-header lancer-primary ">
        <i class="cci cci-infection i--m i--light header-icon"> </i>
        <span class="major">INFECTION</span>
      </div>
      <div class="stat-flow-container">
        <a class="lancer-flow-button lancer-button la-infection-flow-button" data-uuid="${actorUuid}" data-flow-type="InfectionFlow" data-tooltip="Roll an infection check and generate heat damage">
          <i class="fas cci cci-infection i--dark i--s"></i>
        </a>
        <input class="lancer-stat" type="number" name="system.infection" value="${infection}" data-dtype="Number" />
      </div>
    </div>
    `;

    const $card = $(infectionCard);
    $card.find('.la-infection-flow-button').on('click', () => {
        if (infection > 0) {
            _triggerInfectionFlow(actor);
        } else {
            ui.notifications.warn('No infection to check.');
        }
    });

    $burnCard.after($card);

    // NPC sheet: prevent orphan last item from stretching too wide
    const $wrapRow = $burnCard.closest('.wraprow.quintuple');
    if ($wrapRow.length) {
        $wrapRow.children().css('max-width', '20%');
    }
}

function _injectInfectionAltSheet(jHtml, $altBurnInput, actor, infection) {
    const $burnDiv = $altBurnInput.closest('.la-combine-v');
    if (!$burnDiv.length) return;

    const infectionAlt = `
        <div class="la-combine-v -divider -flex0 -width3ch -textaligncenter -glow-prmy -margin0-r la-infection-alt"
             style="--la-primary-color: #1a8a3a; margin-left: 4px;">
            <input class="la-damage__input la-shadow -medium -inset la-text-text -width5 -heightfull -bordersround-lrt -small -bordersoff"
                   type="number" name="system.infection" value="${infection}" data-dtype="Number" />
            <span class="la-damage__span -fontsize0 -heightfull -lineheight1">INFX</span>
        </div>`;
    $burnDiv.after(infectionAlt);
}
