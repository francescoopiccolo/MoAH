// src/worker-sdk/pi-ai.ts
import { Type } from "typebox";

// src/worker-sdk/pi-coding-agent.ts
var DEFAULT_MAX_BYTES = 50 * 1024;
function defineTool(tool) {
  return tool;
}

// node_modules/@earendil-works/pi-coding-agent/examples/extensions/hello.ts
var helloTool = defineTool({
  name: "hello",
  label: "Hello",
  description: "A simple greeting tool",
  parameters: Type.Object({
    name: Type.String({ description: "Name to greet" })
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    return {
      content: [{ type: "text", text: `Hello, ${params.name}!` }],
      details: { greeted: params.name }
    };
  }
});
function hello_default(pi) {
  pi.registerTool(helloTool);
}
export {
  hello_default as default
};
