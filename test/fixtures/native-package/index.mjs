export default function (pi) {
  let starts = 0;
  let counter = 0;
  pi.on("session_start", () => { starts++; });
  pi.registerCommand("native-counter", {
    description: "Increment the native test counter through a Pi command",
    handler: async (_args, ctx) => { counter++; ctx.ui.notify("Counter updated", "info"); },
  });
  pi.registerTool({
    name: "native_counter", label: "Native stateful counter", description: "Read and increment session state using the native Pi context.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(_id, _args, _signal, _update, ctx) {
      counter++;
      return { content: [{ type: "text", text: `native-count=${counter}; starts=${starts}; session=${!!ctx.sessionManager}` }], details: { pid: process.pid } };
    },
  });
}
