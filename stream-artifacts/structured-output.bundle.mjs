// src/worker-sdk/pi-coding-agent.ts
var DEFAULT_MAX_BYTES = 50 * 1024;
function defineTool(tool) {
  return tool;
}

// src/worker-sdk/pi-tui.ts
var Text = class {
  constructor(text, _x = 0, _y = 0) {
    this.text = text;
  }
  text;
};

// data/corpus/earendil-works-pi/d981de1229ef899957bbe968bc8dcda02a21f477/extensions/structured-output.ts
import { Type } from "typebox";
var structuredOutputTool = defineTool({
  name: "structured_output",
  label: "Structured Output",
  description: "Return a final structured answer. Use this as your last action when the user asks for structured output or a machine-readable summary.",
  promptSnippet: "Emit a final structured answer as a terminating tool result",
  promptGuidelines: [
    "Use structured_output as your final action when the user asks for structured output, JSON-like output, or a machine-readable summary.",
    "After calling structured_output, do not emit another assistant response in the same turn."
  ],
  parameters: Type.Object({
    headline: Type.String({ description: "Short title for the result" }),
    summary: Type.String({ description: "One-paragraph summary" }),
    actionItems: Type.Array(Type.String(), { description: "Concrete next steps or key bullets" })
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `Saved structured output: ${params.headline}` }],
      details: {
        headline: params.headline,
        summary: params.summary,
        actionItems: params.actionItems
      },
      terminate: true
    };
  },
  renderResult(result, _options, theme) {
    const details = result.details;
    if (!details) {
      const text = result.content[0];
      return new Text(text?.type === "text" ? text.text : "", 0, 0);
    }
    const lines = [
      theme.fg("toolTitle", theme.bold(details.headline)),
      theme.fg("text", details.summary),
      "",
      ...details.actionItems.map((item, index) => theme.fg("muted", `${index + 1}. ${item}`))
    ];
    return new Text(lines.join("\n"), 0, 0);
  }
});
function structured_output_default(pi) {
  pi.registerTool(structuredOutputTool);
}
export {
  structured_output_default as default
};
