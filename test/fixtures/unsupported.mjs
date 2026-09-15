export default function (pi) {
  // Even swallowing the unsupported call must not produce a successful index.
  try { pi.on("session_start", () => {}); } catch {}
  pi.registerTool({ name: "invalid", label: "Invalid", description: "Has unsupported session behavior", parameters: { type: "object" }, async execute() { return { content: [] }; } });
}
