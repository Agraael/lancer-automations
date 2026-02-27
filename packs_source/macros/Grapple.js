const token = canvas.tokens.controlled[0];
const myActor = token?.actor;

if (!myActor) {
    return ui.notifications.error('⚠️ Please select your mech first!');
}

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Grapple",
    action: {
        name: "Grapple",
        activation: "Quick",
    },
    detail: "Perform a melee attack to grapple a target, end an existing grapple, or break free from a grapple.",
});
