import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = process.cwd();
const expectedDirectory = resolve(repositoryRoot, "src/api/generated");
const temporaryRoot = await mkdtemp(join(tmpdir(), "core-console-api-"));
const actualDirectory = join(temporaryRoot, "generated");
// Resolve Orval's exported CLI subpath while preserving CLI exit behavior.
const orvalCli = fileURLToPath(import.meta.resolve("orval/bin/orval"));

const collectFiles = async (directory, root = directory) => {
  const files = new Map();
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      const nestedFiles = await collectFiles(absolutePath, root);
      for (const [path, contents] of nestedFiles) {
        files.set(path, contents);
      }
    } else if (entry.isFile()) {
      files.set(
        relative(root, absolutePath).replaceAll("\\", "/"),
        await readFile(absolutePath),
      );
    }
  }

  return files;
};

try {
  const generation = spawnSync(
    process.execPath,
    [orvalCli, "--config", "orval.config.ts", "--fail-on-warnings"],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ORVAL_OUTPUT_DIR: actualDirectory.replaceAll("\\", "/"),
      },
      stdio: "inherit",
    },
  );

  if (generation.error) {
    throw generation.error;
  }

  if (generation.status !== 0) {
    throw new Error(
      `Orval exited with status ${generation.status ?? "unknown"}.`,
    );
  }

  const expectedFiles = await collectFiles(expectedDirectory);
  const actualFiles = await collectFiles(actualDirectory);
  const allPaths = [
    ...new Set([...expectedFiles.keys(), ...actualFiles.keys()]),
  ].sort();
  const changedPaths = allPaths.filter((path) => {
    const expected = expectedFiles.get(path);
    const actual = actualFiles.get(path);
    return (
      expected === undefined || actual === undefined || !expected.equals(actual)
    );
  });

  if (changedPaths.length > 0) {
    throw new Error(
      `Generated API client is out of date:\n${changedPaths
        .map((path) => `- ${path}`)
        .join("\n")}\nRun \`pnpm api:generate\` and commit the result.`,
    );
  }

  console.log("Generated API client matches the OpenAPI contract.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
