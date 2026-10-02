import { readFile } from "node:fs/promises";

const expectedNode = (
  await readFile(new URL("../.node-version", import.meta.url), "utf8")
).trim();
const { packageManager } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const expectedPnpm = packageManager.split("@")[1];
const actualPnpm =
  process.env.npm_config_user_agent?.match(/\bpnpm\/([^\s]+)/)?.[1];
const errors = [];

if (process.versions.node !== expectedNode) {
  errors.push(
    `Use Node.js ${expectedNode} from .node-version; running ${process.versions.node}.`,
  );
}

if (actualPnpm !== expectedPnpm) {
  errors.push(
    `Run this check with ${packageManager} from package.json; running ${actualPnpm ? `pnpm@${actualPnpm}` : "without pnpm"}.`,
  );
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Toolchain verified: Node.js ${expectedNode}, ${packageManager}.`,
  );
}
