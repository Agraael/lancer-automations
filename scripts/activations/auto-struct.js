import { getModuleSetting } from '../tools/settings-utils.js';

// The system's structure/overheat buttons and alt-struct's own. Neither matches .lancer-flow-button.
const BUTTON_SELECTOR = '.flow-button[data-flow-type], .alt-struct-flow-button[data-flow-type]';
const CLICK_STAGGER_MS = 250;

const pendingClick = new Set();

export function initAutoStruct()
{
    Hooks.on('createChatMessage', message =>
    {
        if (!getModuleSetting('autoStructFollowup'))
            return;
        if (message.author?.id !== game.user.id)
            return;
        pendingClick.add(message.id);
    });

    Hooks.on('renderChatMessageHTML', (message, htmlOrEl) =>
    {
        if (!pendingClick.delete(message.id))
            return;
        const root = htmlOrEl instanceof HTMLElement ? htmlOrEl : htmlOrEl?.[0];
        const buttons = root?.querySelectorAll(BUTTON_SELECTOR);
        if (!buttons?.length)
            return;
        // deferred so the system's and alt-struct's own render hooks have bound their handlers first
        buttons.forEach((button, index) => setTimeout(() => button.click(), index * CLICK_STAGGER_MS));
    });
}
