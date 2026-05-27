import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toHtml } from "@ohah/hwpjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const data = JSON.parse(readFileSync(join(root, "src", "questionData.json"), "utf8"));
const outDir = join(root, "public", "hwp-html");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let converted = 0;

for (const document of data.documents) {
  if (extname(document.fileName).toLowerCase() !== ".hwp") continue;

  const sourcePath = join(root, "public", document.filePath);
  const html = toHtml(readFileSync(sourcePath), {
    includeVersion: true,
    includePageInfo: true,
  });

  writeFileSync(join(outDir, `${document.id}.html`), html, "utf8");
  converted += 1;
}

console.log(`generated hwp html=${converted}`);
