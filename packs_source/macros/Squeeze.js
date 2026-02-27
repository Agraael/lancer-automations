const myActor = ParamActor || canvas.tokens.controlled[0]?.actor;

if (!myActor) {
    return ui.notifications.error("⚠️ Please select your mech first!");
}

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Squeeze",
    action: {
        name: "Squeeze",
        activation: "Free",
    },
    detail: "A character may squeeze as a free action, treating themselves as one Size smaller for the purposes of movement. While squeezing, the character is additionally treated as Prone. The character may stop squeezing as a free action while in a space able to accommodate their normal Size."
});
