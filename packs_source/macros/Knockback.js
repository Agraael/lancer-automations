const targets = canvas.tokens.controlled;
if (!targets || targets.length === 0)
    return ui.notifications.error('Please select one or more tokens to knock back!');

const api = game.modules.get('lancer-automations').api;

await api.knockBackToken(targets, -1, {
    title: "KNOCKBACK",
    description: "Place each token at its knockback destination."
});
