const token = canvas.tokens.controlled[0];
const myActor = token?.actor;

if (!myActor) {
    return ui.notifications.error('⚠️ Please select your mech first!');
}

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Ram",
    action: {
        name: "Ram",
        activation: "Quick",
    },
    detail: "make a melee attack against an adjacent character the same SIZE or smaller than you. On a success, your target is knocked PRONE and you may also choose to knock them back by one space, directly away from you.",
});
