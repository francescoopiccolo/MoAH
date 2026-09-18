import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { runSingle, type BenchmarkSuite } from "./runner.js";

async function readSuite(suitePath: string): Promise<BenchmarkSuite> {
  return JSON.parse(await readFile(resolve(suitePath), "utf8")) as BenchmarkSuite;
}

export async function ensureLangSmithDataset(suitePath: string): Promise<string> {
  const suite = await readSuite(suitePath);
  const client = new Client();
  const datasetName = `moah-${suite.suite}`;
  const existing = await client.readDataset({ datasetName }).catch(() => undefined);
  if (existing) return datasetName;

  const dataset = await client.createDataset(datasetName, {
    description: `MoAH benchmark suite: ${suite.suite}`,
  });
  await client.createExamples(suite.tasks.map(task => ({
    dataset_id: dataset.id,
    inputs: {
      taskId: task.id,
      prompt: task.prompt,
      files: task.files ?? {},
    },
    outputs: {
      expectedSuccess: true,
    },
    metadata: {
      suite: suite.suite,
      oracleTools: task.oracleTools ?? [],
      requiredTools: task.requiredTools ?? [],
    },
  })));
  return datasetName;
}

export async function runLangSmithExperiment(
  suitePath: string,
  cwd: string,
  profile: string,
): Promise<unknown> {
  const suite = await readSuite(suitePath);
  if (!suite.profiles.includes(profile)) throw new Error(`Unknown profile: ${profile}`);
  const datasetName = await ensureLangSmithDataset(suitePath);
  const client = new Client();

  const target = async (input: any) => {
    const result = await runSingle(suitePath, cwd, {
      taskId: input.taskId as string,
      profile,
      repetition: 1,
    });
    return {
      success: result.success,
      elapsedMs: result.elapsedMs,
      timeout: result.timeout,
      exitCode: result.exitCode,
      traceMetrics: result.traceMetrics,
      mainMetrics: result.mainMetrics,
      totalCost: result.totalCost,
    };
  };

  const successEvaluator = ({ outputs }: { outputs: Record<string, any> }) => ({
    key: "task_success",
    score: outputs.success ? 1 : 0,
    comment: outputs.success ? "verifier passed" : "verifier failed",
  });

  const latencyEvaluator = ({ outputs }: { outputs: Record<string, any> }) => ({
    key: "end_to_end_latency_ms",
    score: Number(outputs.elapsedMs ?? 0),
    comment: `${outputs.elapsedMs ?? 0} ms`,
  });

  const routerUsageEvaluator = ({ outputs }: { outputs: Record<string, any> }) => {
    const usage = outputs.traceMetrics?.usage ?? {};
    return {
      key: "router_total_tokens",
      score: Number(usage.totalTokens ?? 0),
      comment: JSON.stringify(usage),
    };
  };

  const totalCostEvaluator = ({ outputs }: { outputs: Record<string, any> }) => ({
    key: "total_cost",
    score: Number(outputs.totalCost ?? 0),
    comment: `${outputs.totalCost ?? 0}`,
  });

  return evaluate(target, {
    data: datasetName,
    client,
    experimentPrefix: `moah-${profile}`,
    numRepetitions: suite.repetitions,
    evaluators: [successEvaluator, latencyEvaluator, routerUsageEvaluator, totalCostEvaluator],
  });
}
