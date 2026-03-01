const myActor = (typeof ParamActor !== 'undefined' ? ParamActor : null) || canvas.tokens.controlled[0]?.actor;

if (!myActor) {
    return ui.notifications.error("⚠️ Please select your mech first!");
}

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Shut Down",
    action: {
        name: "Shut Down",
        activation: "Quick",
    },
    detail: "Shut down your mech as a desperate measure, to end system attacks, regain control of AI, and cool your mech. The mech is STUNNED until rebooted via the BOOT UP action."
});
