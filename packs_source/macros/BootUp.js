const myActor = (typeof ParamActor !== 'undefined' ? ParamActor : null) || canvas.tokens.controlled[0]?.actor;

if (!myActor) {
    return ui.notifications.error("⚠️ Please select your mech first!");
}

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Boot Up",
    action: {
        name: "Boot Up",
        activation: "Full",
    },
    detail: "You can BOOT UP a mech that you are piloting as a full action, clearing SHUT DOWN and restoring your mech to a powered state."
});
