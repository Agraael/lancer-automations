const targets = Array.from(game.user.targets);
if (targets.length === 0) return ui.notifications.error('You must target at least one token!');

const myActor = (typeof ParamActor !== 'undefined' ? ParamActor : null) || canvas.tokens.controlled[0]?.actor;
if (!myActor) return ui.notifications.error('Please select your token first!');

const targetNames = targets.map(t => t.name).join(', ');
const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Scan",
    action: {
        name: "Scan",
        activation: "Quick",
    },
    detail: "Scanning targets... " + targetNames,
});
