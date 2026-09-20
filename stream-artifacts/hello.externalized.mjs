import { Type } from "../src/worker-sdk/pi-ai.ts";
import { defineTool } from "../src/worker-sdk/pi-coding-agent.ts";

const helloTool = defineTool({
  name: "hello",
  label: "Hello",
  description: "A simple greeting tool",
  parameters: Type.Object({
    name: Type.String({ description: "Name to greet" }),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `Hello, ${params.name}!` }],
      details: { greeted: params.name },
    };
  },
});

export default function (pi) {
  pi.registerTool(helloTool);
}
