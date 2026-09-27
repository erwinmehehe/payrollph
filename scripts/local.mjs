import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const composeFile = "docker-compose.local.yml";
const envPath = path.join(root, ".env.local");
const envExamplePath = path.join(root, ".env.local.example");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function fail(message) {
  console.error(`\n[local] ${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    env: options.env ?? process.env,
  });

  if (result.error) return { ok: false, error: result.error, stdout: "", stderr: "" };
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseEnvFile(file) {
  const env = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPostgres() {
  process.stdout.write("[local] Waiting for PostgreSQL");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = run(
      "docker",
      ["compose", "-f", composeFile, "exec", "-T", "postgres", "pg_isready", "-U", "postgres", "-d", "payrollph"],
      { capture: true },
    );
    if (ready.ok) {
      process.stdout.write(" ready.\n");
      return;
    }
    process.stdout.write(".");
    await sleep(1000);
  }
  process.stdout.write("\n");
  fail("PostgreSQL did not become ready. Run 'docker compose -f docker-compose.local.yml logs postgres' for details.");
}

async function main() {
  console.log("\n[local] Starting Linaw Payroll locally...");

  const dockerVersion = run("docker", ["--version"], { capture: true });
  if (!dockerVersion.ok) {
    fail("Docker Desktop is required. Install/start Docker, then run 'npm run local' again.");
  }

  const composeVersion = run("docker", ["compose", "version"], { capture: true });
  if (!composeVersion.ok) {
    fail("Docker Compose is not available. Update/start Docker Desktop, then retry.");
  }

  const daemon = run("docker", ["info"], { capture: true });
  if (!daemon.ok) {
    fail("Docker is installed but the Docker engine is not running. Start Docker Desktop, then retry.");
  }

  if (!existsSync(envPath)) {
    if (!existsSync(envExamplePath)) fail(".env.local.example is missing.");
    copyFileSync(envExamplePath, envPath);
    console.log("[local] Created .env.local from the safe local template.");
  } else {
    console.log("[local] Using existing .env.local.");
  }

  const localEnv = parseEnvFile(envPath);
  const childEnv = {
    ...process.env,
    ...localEnv,
    // npm run local is deliberately safe: live PayMongo disbursements stay off
    // even if an existing local file accidentally contains a different value.
    PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  };

  if (!childEnv.DATABASE_URL) {
    fail("DATABASE_URL is missing from .env.local.");
  }

  if (!existsSync(path.join(root, "node_modules", ".bin", process.platform === "win32" ? "drizzle-kit.cmd" : "drizzle-kit"))) {
    console.log("[local] Installing npm dependencies...");
    const install = run(npmCommand, ["ci"], { env: childEnv });
    if (!install.ok) fail("npm ci failed.");
  }

  console.log("[local] Starting local PostgreSQL...");
  const composeUp = run("docker", ["compose", "-f", composeFile, "up", "-d", "postgres"]);
  if (!composeUp.ok) {
    fail("Could not start PostgreSQL. Port 5432 may already be in use; stop the conflicting service and retry.");
  }

  await waitForPostgres();

  console.log("[local] Applying the current database schema...");
  const schema = run(npxCommand, ["drizzle-kit", "push"], { env: childEnv });
  if (!schema.ok) fail("Database schema initialization failed.");

  console.log("[local] Live disbursements: OFF");
  console.log("[local] Opening app at http://localhost:3000");
  console.log("[local] Press Ctrl+C to stop the Next.js dev server. PostgreSQL stays running for the next start.\n");

  const dev = spawn(npmCommand, ["run", "dev"], {
    cwd: root,
    stdio: "inherit",
    env: childEnv,
  });

  dev.on("error", (error) => fail(`Could not start Next.js: ${error.message}`));
  dev.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

await main();
