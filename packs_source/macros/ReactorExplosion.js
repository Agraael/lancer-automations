const token = canvas.tokens.controlled[0];
if (!token)
    return ui.notifications.error('Please select your mech first!');
const api = game.modules.get('lancer-automations').api;
await api.executeReactorExplosion(token);
