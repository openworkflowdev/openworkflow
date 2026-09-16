import type { Command } from "commander";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Backend } from "openworkflow/internal";
import { PostHog } from "posthog-node";

interface Telemetry {
  program: Command;
  client: PostHog;
  distinctId: string;
  helpCommand?: Command;
  version?: boolean;
}
let telemetry: Telemetry | undefined;

const backendTypes = new Map([
  ["BackendSqlite", "sqlite"],
  ["BackendPostgres", "postgres"],
  ["sqlite", "sqlite"],
  ["postgres", "postgres"],
  ["both", "both"],
]);

/**
 * Set up telemetry before the CLI prints output.
 * @param program - Root CLI command
 */
export function initializeTelemetry(program: Command): void {
  telemetry = undefined;
  if (
    process.env["DO_NOT_TRACK"] ||
    process.env["OPENWORKFLOW_TELEMETRY_DISABLED"] ||
    process.env["CI"] ||
    process.argv.includes("--no-telemetry")
  )
    return;

  try {
    const directory = path.join(homedir(), ".openworkflow");
    const file = path.join(directory, "telemetry-id");
    mkdirSync(directory, { recursive: true });
    if (!existsSync(file)) {
      writeFileSync(file, randomUUID(), { flag: "wx", mode: 0o600 });
      console.error(
        "OpenWorkflow collects CLI usage via PostHog. Set DO_NOT_TRACK=1 to opt out.\n" +
          "https://openworkflow.dev/docs/cli#telemetry\n",
      );
    }
    const distinctId = readFileSync(file, "utf8").trim();
    if (!distinctId) return;
    const state: Telemetry = {
      program,
      distinctId,
      client: new PostHog("phc_C1Cm1NAKHDFA3eKLVqcYzR5wUk8WhSbMMXltk5Qj1Ye"),
    };
    program.on("beforeAllHelp", ({ command }: { command: Command }) => {
      state.helpCommand = command;
    });
    program.on("option:version", () => {
      state.version = true;
    });
    telemetry = state;
  } catch {
    // ignore, telemetry is optional
  }
}

/**
 * Track after loading config or choosing an init backend.
 * Help, version, and argument errors are tracked without a backend.
 * @param backend - Configured backend or init selection
 */
export function trackCommand(
  backend?: Backend | "sqlite" | "postgres" | "both",
): void {
  const state = telemetry;
  if (!state) return;
  try {
    let command = state.helpCommand ?? state.program;
    let child: Command | undefined;
    while (
      (child = command.commands.find(
        (candidate) => candidate.name() === command.args[0],
      ))
    ) {
      command = child;
    }
    const backendName =
      typeof backend === "string" ? backend : backend?.constructor.name;
    const commandName = command.parent?.parent
      ? `${command.parent.name()} ${command.name()}`
      : command.name();
    state.client.capture({
      distinctId: state.distinctId,
      event: "cli_command_invoked",
      properties: {
        command: state.version ? "version" : commandName,
        backend: backendName
          ? (backendTypes.get(backendName) ?? "custom")
          : undefined,
        help: state.helpCommand ? true : undefined,
        cli_version: state.program.version(),
        os: process.platform,
        arch: process.arch,
        node_version: process.versions.node,
      },
    });
  } catch {
    // ignore, telemetry is optional
  }
}

/** Send queued events before the CLI exits. */
export async function shutdownTelemetry(): Promise<void> {
  try {
    await telemetry?.client.shutdown();
  } catch {
    // ignore, telemetry is optional
  }
}
