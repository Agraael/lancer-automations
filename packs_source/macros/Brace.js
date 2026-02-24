const token = canvas.tokens.controlled[0];
const myActor = token?.actor;

if (!myActor) {
    return ui.notifications.error('You must select at least one token first!');
}

const SimpleActivationFlow = game.lancer?.flows?.get("SimpleActivationFlow");
const flow = new SimpleActivationFlow(myActor, {
    title: "Brace",
    action: {
        name: "Brace",
        activation: "Reaction",
    },
    detail: "You count as having RESISTANCE to all damage, burn, and heat from the triggering attack, and until the end of your next turn, all other attacks against you are made at +1 difficulty. Due to the stress of bracing, you cannot take reactions until the end of your next turn and on that turn, you can only take one quick action – you cannot OVERCHARGE, move normally, take full actions, or take free actions."
});
await flow.begin();
