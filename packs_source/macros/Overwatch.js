const myActor = ParamActor || canvas.tokens.controlled[0]?.actor;

if (!myActor) {
    return ui.notifications.error('Please select your mech first!');
}

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Overwatch",
    action: {
        name: "Overwatch",
        activation: "Reaction",
    },
    detail: "Trigger: A hostile character starts any movement (including BOOST and other actions) inside one of your weapons' THREAT.<br>Effect: Trigger OVERWATCH, immediately using that weapon to SKIRMISH against that character as a reaction, before they move."
});
