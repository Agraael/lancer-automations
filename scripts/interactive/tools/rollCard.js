import { _queueCard, _createInfoCard, _removeInfoCard } from "../cards.js";
import { _bindItemChip } from "../network.js";
import { createTokenMark } from "../target-shapes.js";

/**
 * Card that rolls a plain formula from a token, to chat. Resolves { total, formula, roll },
 * or null on cancel.
 * @param {Object} [options]
 * @param {string} [options.title='ROLL']
 * @param {string} [options.description]
 * @param {string} [options.roll='1d20']  Preset formula, editable in the card
 * @param {boolean} [options.allowEdit=true]
 * @param {string} [options.flavor]  Chat flavor line, defaults to the title
 * @param {Token} [options.originToken]  Roller: speaker, canvas mark, header chip
 * @param {Token} [options.relatedToken]
 * @param {any} [options.item]
 * @param {string} [options.icon]
 * @param {boolean} [options.urgent]
 * @returns {Promise<{total: number, formula: string, roll: Roll}|null>}
 */
export function rollCard(options = {})
{
    const {
        title = 'ROLL',
        description = '',
        roll = '1d20',
        allowEdit = true,
        flavor = '',
        originToken = null,
        relatedToken = null,
        item = null,
        icon = null,
        urgent = false,
    } = /** @type {any} */ (options);

    return _queueCard(() => new Promise((resolve) =>
    {
        let cardEl;
        let originMark = null;
        const cleanup = () =>
        {
            originMark?.destroy();
            originMark = null;
            _removeInfoCard(cardEl);
        };

        cardEl = _createInfoCard("rollCard", {
            title,
            description,
            ...(icon ? { icon } : {}),
            rollFormula: roll,
            allowEdit,
            originToken,
            relatedToken,
            onCancel: () =>
            {
                cleanup();
                resolve(null);
            },
        });
        _bindItemChip(cardEl, item);
        if (originToken)
            originMark = createTokenMark(originToken);

        const input = cardEl.find('[data-role="roll-formula"]');
        cardEl.find('[data-role="item-chip"]').insertBefore(input);
        const doRoll = async () =>
        {
            const formula = String(input.val() ?? '').trim();
            if (!formula || !Roll.validate(formula))
            {
                input.css('border-color', '#c33');
                setTimeout(() => input.css('border-color', ''), 800);
                return;
            }
            cardEl.find('[data-action="do-roll"]').prop('disabled', true);
            const rollObj = new Roll(formula, originToken?.actor?.getRollData?.() ?? {});
            await rollObj.evaluate();
            await rollObj.toMessage({
                speaker: ChatMessage.getSpeaker({ token: originToken?.document, actor: originToken?.actor }),
                flavor: flavor || title,
            });
            cleanup();
            resolve({ total: rollObj.total, formula: rollObj.formula, roll: rollObj });
        };

        cardEl.find('[data-action="do-roll"]').on('click', doRoll);
        input.on('keydown', (ev) =>
        {
            if (ev.key === 'Enter')
            {
                ev.preventDefault();
                doRoll();
            }
        });
    }), title, { urgent });
}
