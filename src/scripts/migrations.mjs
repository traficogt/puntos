import fs from "node:fs";
import path from "node:path";
import { closeDatabase, listManagedMigrations, runManagedMigrations } from "../app/database.js";

const cmd = process.argv[2] || "status";
const migrationsDir = path.join(process.cwd(), "src", "app", "migrations");

function migrationFiles() {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
}

async function printStatus() {
  const files = migrationFiles();
  const applied = await listManagedMigrations();
  const appliedSet = new Set(applied.map((m) => m.version));

  console.log(`Managed migrations dir: ${migrationsDir}`);
  if (!files.length) {
    console.log("No SQL migrations found.");
    return;
  }

  for (const file of files) {
    console.log(`${appliedSet.has(file) ? "APPLIED" : "PENDING"} ${file}`);
  }
}

async function main() {
  try {
    if (cmd === "apply") {
      await runManagedMigrations();
      await printStatus();
      return;
    }
    if (cmd === "status") {
      await printStatus();
      return;
    }
    console.error("Usage: node src/scripts/migrations.mjs [status|apply]");
    process.exitCode = 1;
  } finally {
    await closeDatabase().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
