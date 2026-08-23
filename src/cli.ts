import { runCli } from "./transport/cli.ts";

const exitCode = await runCli();
if (exitCode !== 0) process.exitCode = exitCode;
