const myActor = (typeof ParamActor !== 'undefined' ? ParamActor : null) || canvas.tokens.controlled[0]?.actor;

if (!myActor) {
    return ui.notifications.error("⚠️ Please select your mech first!");
}

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Lock On",
    action: {
        name: "Lock On",
        activation: "Quick",
    },
    detail: "Choose a character within SENSORS and line of sight. They gain the LOCK ON condition. Any character making an attack against a character with LOCK ON may choose to gain +1 Accuracy on that attack and then clear the LOCK ON condition after that attack resolves."
});
