import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const mod = jiti("../next.config.ts");
const webRoot =
  mod.default?.turbopack?.root ??
  mod.turbopack?.root;
console.log("turbopack.root from loaded config:", webRoot);
console.log("cwd:", process.cwd());
const selfMeta = path.dirname(
  new URL(import.meta.url).pathname
);
console.log("this script dirname:", selfMeta);
