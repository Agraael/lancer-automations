const myActor = ParamActor || canvas.tokens.controlled[0]?.actor;

if (!myActor) {
    return ui.notifications.error("⚠️ Please select your mech first!");
}

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Hide",
    action: {
        name: "Hide",
        activation: "Quick",
    },
    detail: "Obscure the position of your mech, becoming HIDDEN and unable to be identified, precisely located, or be targeted directly by attacks or hostile actions"
});
