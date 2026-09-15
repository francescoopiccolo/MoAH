export default function (pi) {
  const memory = Buffer.alloc(16 * 1024 * 1024, 7);
  pi.registerTool({
    name: "search_remote", label: "Search remote", description: "Search the web for current documentation.",
    parameters: { type: "object", properties: { delay: { type: "number" } }, additionalProperties: false },
    async execute(id, { delay = 0 }, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "working" }], details: {} });
      await new Promise(resolve => setTimeout(resolve, delay));
      return { content: [{ type: "text", text: "remote-ok" }], details: { pid: process.pid, cwd: ctx.cwd, byte: memory[0] } };
    },
  });
  pi.registerTool({
    name: "inspect_db", label: "Inspect database", description: "Inspect a database schema.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() { return { content: [{ type: "text", text: "db-ok" }], details: { pid: process.pid } }; },
  });
}
