const myActor = (typeof ParamActor !== 'undefined' ? ParamActor : null) || canvas.tokens.controlled[0]?.actor;

if (!myActor) {
    return ui.notifications.error('You must select at least one token first!');
}

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Bolster",
    action: {
        name: "Bolster",
        activation: "Quick",  // Type d'activation (Quick, Full, etc.)
    },
    detail: "Choose a character within SENSORS. They receive +2 Accuracy on the next skill check or save they make between now and the end of their next turn. Characters can only benefit from one BOLSTER at a time."
});
