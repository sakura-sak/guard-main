import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadOpenApiYaml, parseOpenApiYaml, renderOpenApiHtml } from "../lib/openapi-html"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const html = renderOpenApiHtml(parseOpenApiYaml(loadOpenApiYaml(root)))
const outDir = join(root, "docs", "api")
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, "Guard-API.html")
writeFileSync(outFile, html, "utf8")
console.log("Wrote", outFile)
