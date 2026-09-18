import { MoahProcessAdapter } from "./index.js";

const adapter = new MoahProcessAdapter();
await adapter.initialize();
console.log(JSON.stringify({
  status: "ready",
  moahCli: process.env.MOAH_CLI,
  config: process.env.MOAH_CONFIG,
  supportedProfiles: ["pi-default", "pi-full", "moah-auto", "moah-suggest", "moah-oracle"],
}, null, 2));
