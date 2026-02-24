const token = canvas.tokens.controlled[0];
const myActor = token?.actor;

if (!myActor) {
    return ui.notifications.error('⚠️ Please select your mech first!');
}

const SimpleActivationFlow = game.lancer?.flows?.get("SimpleActivationFlow");
const flow = new SimpleActivationFlow(myActor, {
    title: "Ram",
    action: {
        name: "Ram",
        activation: "Quick",
    },
    detail: "make a melee attack against an adjacent character the same SIZE or smaller than you. On a success, your target is knocked PRONE and you may also choose to knock them back by one space, directly away from you.",
});
await flow.begin();
