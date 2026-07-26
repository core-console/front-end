import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultSource = resolve(
  repositoryRoot,
  "../back-end/openapi/openapi.json",
);
const sourcePath = resolve(repositoryRoot, process.argv[2] ?? defaultSource);
const targetPath = resolve(repositoryRoot, "openapi/openapi.json");

if (sourcePath === targetPath) {
  throw new Error("The OpenAPI source and target must be different files.");
}

const source = await readFile(sourcePath, "utf8");

let document;
try {
  document = JSON.parse(source);
} catch (error) {
  throw new Error(`OpenAPI source is not valid JSON: ${sourcePath}`, {
    cause: error,
  });
}

if (
  document === null ||
  typeof document !== "object" ||
  Array.isArray(document) ||
  typeof document.openapi !== "string" ||
  !document.openapi.startsWith("3.") ||
  document.info === null ||
  typeof document.info !== "object" ||
  Array.isArray(document.info) ||
  document.paths === null ||
  typeof document.paths !== "object" ||
  Array.isArray(document.paths)
) {
  throw new Error(
    `OpenAPI source is missing the required OpenAPI 3 document fields: ${sourcePath}`,
  );
}

const formattedDocument = await format(JSON.stringify(document), {
  parser: "json",
});

await writeFile(targetPath, formattedDocument, "utf8");

console.log(`Synced ${sourcePath} to ${relative(repositoryRoot, targetPath)}.`);
