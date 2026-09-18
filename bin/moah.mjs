#!/usr/bin/env node
try {
  const { main } = await import("../dist/src/cli.js");
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
