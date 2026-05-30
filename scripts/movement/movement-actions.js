/* global Hooks, CONFIG */

Hooks.once('init', () => {
    const actions = CONFIG.Token?.movement?.actions;
    if (!actions)
        return;

    if (actions.fly) {
        actions.fly.icon = 'fa-solid fa-fighter-jet';
    }

    if (actions.crawl) {
        const baseCanSelect = actions.crawl.canSelect;
        actions.crawl.canSelect = (tokenLike) => {
            const actor = tokenLike?.actor;
            const prone = !!actor?.statuses?.has?.('prone');
            if (!prone)
                return false;
            return baseCanSelect ? baseCanSelect(tokenLike) : true;
        };
    }
});
