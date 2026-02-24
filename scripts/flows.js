/**
 * Custom flows for Lancer Automations
 */

export function registerModuleFlows(flowSteps, flows) {

    const ActivationFlow = flows.get("ActivationFlow");
    if (!ActivationFlow) {
        console.error("lancer-automations | Could not find ActivationFlow to retrieve base Flow class");
        return;
    }
    const Flow = Object.getPrototypeOf(ActivationFlow);

    class SimpleActivationFlow extends Flow {
        constructor(uuid, data) {
            const initialData = {
                type: "action",
                title: data?.title || "",
                action: data?.action || null,
                detail: data?.detail || "",
                tags: data?.tags || []
            };
            super(uuid, initialData);
        }
    }

    SimpleActivationFlow.steps = ["printActionUseCard"];
    flows.set("SimpleActivationFlow", SimpleActivationFlow);
    console.log("lancer-automations | Registered SimpleActivationFlow");

}
