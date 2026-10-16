// Design lint: tokens are the only source of colours and type sizes.
// Fails on hex/rgb colours, Tailwind default or arbitrary font sizes, and inline font sizes anywhere in src/
// except the token stylesheets (src/styles) and the generated brand marks.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SRC = join(ROOT, "src");
const EXEMPT = [join(SRC, "styles"), join(SRC, "brand")];
const RULES = [
  { name: "hex colour", re: /#[0-9a-fA-F]{3,8}\b(?![\w/-])/g },
  { name: "rgb()/hsl() colour", re: /\b(?:rgba?|hsla?)\(/g },
  { name: "arbitrary font size", re: /\btext-\[(?:\d|calc|var)/g },
  { name: "Tailwind default font size (use the type scale)", re: /\btext-(?:xs|sm|base|lg|[2-9]?xl)\b/g },
  { name: "inline font size", re: /\bfont-?[sS]ize\s*:/g },
  { name: "arbitrary leading/tracking", re: /\b(?:leading|tracking)-\[/g },
];

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (EXEMPT.some((e) => p.startsWith(e))) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(f) ? [p] : [];
  });
}

const problems = [];
for (const file of walk(SRC)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.re)) problems.push(`${relative(ROOT, file)}:${i + 1}  ${rule.name}: ${m[0]}`);
    }
  });
}
if (problems.length) {
  console.error(`Design lint failed (${problems.length}):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("Design lint passed: colours and type sizes come only from src/styles/tokens.css");
