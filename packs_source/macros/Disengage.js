const myActor = ParamActor || canvas.tokens.controlled[0]?.actor;

if (!myActor) {
    return ui.notifications.error("⚠️ Please select your mech first!");
}

const SimpleActivationFlow = game.lancer?.flows?.get("SimpleActivationFlow");
const flow = new SimpleActivationFlow(myActor, {
    title: "Disengage",
    action: {
        name: "Disengage",
        activation: "Full",
    },
    detail: "Until the end of your current turn, you ignore engagement and your movement does not provoke reactions.",
});

await flow.begin();
