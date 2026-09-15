export default function (pi) {
  pi.registerTool({
    name: "plan_task", label: "Plan fixture", description: "Create a plan before implementing a change.",
    promptSnippet: "PLAN_ONLY_SNIPPET",
    promptGuidelines: ["PLAN_ONLY_GUIDELINE: include dependencies in the plan."],
    parameters: { type: "object", properties: { planning_only_parameter: { type: "string" } }, additionalProperties: false },
    async execute() {
      return { content: [{ type: "text", text: "PLAN_RESULT: first research the API, then implement the change." }], details: { pid: process.pid } };
    },
  });
}
