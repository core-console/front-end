import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const repositoryRoot = process.cwd();
const outputDirectory = resolve(repositoryRoot, "dist");
const indexPath = join(outputDirectory, "index.html");
const assetsDirectory = join(outputDirectory, "assets");
const textExtensions = new Set([".css", ".html", ".js", ".json"]);
const knownDevelopmentMarkers = [
  "@faker-js/faker",
  "axe-core",
  "Mock Service Worker",
  "playwright",
  "ReactQueryDevtools",
  "TanStack Query Devtools",
  "testing-library",
];

const collectFiles = async (directory) => {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
};

try {
  if (!(await stat(indexPath)).isFile()) {
    throw new Error("Production build did not emit dist/index.html.");
  }

  const assetFiles = await collectFiles(assetsDirectory);
  if (!assetFiles.some((path) => extname(path) === ".js")) {
    throw new Error("Production build did not emit a JavaScript asset.");
  }

  const outputFiles = await collectFiles(outputDirectory);
  const forbiddenWorker = outputFiles.find(
    (path) => relative(outputDirectory, path) === "mockServiceWorker.js",
  );
  if (forbiddenWorker) {
    throw new Error(
      "Production build contains the development-only MSW worker.",
    );
  }

  for (const path of outputFiles) {
    if (!textExtensions.has(extname(path))) {
      continue;
    }

    const contents = await readFile(path, "utf8");
    const marker = knownDevelopmentMarkers.find((value) =>
      contents.includes(value),
    );
    if (marker) {
      throw new Error(
        `Production build contains dev/test-only marker "${marker}" in ${relative(
          repositoryRoot,
          path,
        )}.`,
      );
    }
  }

  console.log(
    `Production artifact structure validated; known development-only markers were not detected (${outputFiles.length} files checked).`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
