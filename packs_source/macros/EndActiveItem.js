const token = (typeof ParamToken !== 'undefined' ? ParamToken : null) || canvas.tokens.controlled[0];
if (!token)
    return ui.notifications.error('Please select your token first!');

const api = game.modules.get('lancer-automations').api;
await api.openEndActivationMenu(token);
