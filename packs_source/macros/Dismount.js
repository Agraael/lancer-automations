const myActor = ParamActor || canvas.tokens.controlled[0]?.actor;

if (!myActor) {
    return ui.notifications.error('Please select your mech first!');
}

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Dismount",
    action: {
        name: "Dismount",
        activation: "Full",
    },
    detail: "When you DISMOUNT, you climb off of a mech. You can DISMOUNT as a full action. When you DISMOUNT, you are placed in an adjacent space – if there are no free spaces, you cannot DISMOUNT. Additionally, you can also DISMOUNT willing allied mechs or vehicles you have MOUNTED."
});
