const myActor = ParamActor || canvas.tokens.controlled[0]?.actor;

if (!myActor) {
    return ui.notifications.error("⚠️ Please select your mech first!");
}

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Aid",
    action: { name: "AID", activation: "Quick" },
    detail: "You assist a mech so it can Stabilize more easily. Choose an adjacent character. On their next turn, they may Stabilize as a quick action. They can choose to take this action even if they normally would not be able to take actions (for example, by being affected by the Stunned condition)."
});
