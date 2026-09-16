import fs from "node:fs"
import path from "node:path"

export type OpenApiOp = {
  method: string
  path: string
  tags: string[]
  summary: string
  description: string
  deprecated: boolean
  security: string[]
  responses: Array<{ code: string; description: string }>
}

export type OpenApiDoc = {
  title: string
  version: string
  description: string
  tags: Array<{ name: string; description: string }>
  operations: OpenApiOp[]
}

const METHODS = new Set(["get", "post", "put", "patch", "delete"])

const SECURITY_LABEL: Record<string, string> = {
  cookieAuth: "сессия admin/пользователя (cookie guard_session)",
  moodleApiKey: "заголовок X-API-Key",
  moodleBearer: "Authorization: Bearer",
  cronSecret: "заголовок X-Cron-Secret",
  qrSignature: "подпись QR (query sig)",
}

export function openApiYamlPath(cwd = process.cwd()): string {
  return path.join(cwd, "openapi.yaml")
}

export function loadOpenApiYaml(cwd = process.cwd()): string {
  return fs.readFileSync(openApiYamlPath(cwd), "utf8")
}

function unquote(raw: string): string {
  const s = raw.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

function parseFlowList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "")
  if (!inner.trim()) return []
  return inner.split(",").map((x) => unquote(x.replace(/:\s*\[\]\s*$/, "").trim())).filter(Boolean)
}

export function parseOpenApiYaml(text: string): OpenApiDoc {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const doc: OpenApiDoc = {
    title: "API",
    version: "",
    description: "",
    tags: [],
    operations: [],
  }

  let i = 0
  const indentOf = (line: string) => line.match(/^ */)?.[0].length ?? 0

  const readBlock = (baseIndent: number): string => {
    const out: string[] = []
    while (i < lines.length) {
      const line = lines[i]
      if (line.trim() === "") {
        out.push("")
        i += 1
        continue
      }
      if (indentOf(line) <= baseIndent && line.trim() !== "") break
      out.push(line.slice(baseIndent + 2))
      i += 1
    }
    return out.join("\n").trim()
  }

  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith("  title:")) doc.title = unquote(line.slice("  title:".length))
    if (line.startsWith("  version:")) doc.version = unquote(line.slice("  version:".length))
    if (line === "  description: |") {
      i += 1
      doc.description = readBlock(2)
      continue
    }
    if (line.startsWith("  - name:") && doc.operations.length === 0) {
      const name = unquote(line.slice("  - name:".length))
      let description = ""
      i += 1
      if (lines[i]?.startsWith("    description:")) {
        description = unquote(lines[i].slice("    description:".length))
        i += 1
      }
      doc.tags.push({ name, description })
      continue
    }
    if (line.startsWith("  /") && line.endsWith(":")) {
      const apiPath = line.trim().slice(0, -1)
      i += 1
      while (i < lines.length) {
        const mLine = lines[i]
        if (mLine.startsWith("  /") || mLine.startsWith("components:")) break
        const methodMatch = mLine.match(/^    (get|post|put|patch|delete):$/)
        if (!methodMatch || !METHODS.has(methodMatch[1])) {
          i += 1
          continue
        }
        const method = methodMatch[1]
        const op: OpenApiOp = {
          method,
          path: apiPath,
          tags: [],
          summary: "",
          description: "",
          deprecated: false,
          security: [],
          responses: [],
        }
        i += 1
        let securityIsPublic = false
        while (i < lines.length) {
          const ol = lines[i]
          if (ol.match(/^    (get|post|put|patch|delete):$/) || ol.startsWith("  /") || ol.startsWith("components:")) {
            break
          }
          if (ol.startsWith("      tags:")) op.tags = parseFlowList(ol.slice("      tags:".length))
          else if (ol.startsWith("      summary:")) op.summary = unquote(ol.slice("      summary:".length))
          else if (ol === "      description: |") {
            i += 1
            op.description = readBlock(6)
            continue
          } else if (ol.startsWith("      description:")) op.description = unquote(ol.slice("      description:".length))
          else if (ol.startsWith("      deprecated:")) op.deprecated = /true/i.test(ol)
          else if (ol.startsWith("      security:")) {
            const rest = ol.slice("      security:".length).trim()
            if (rest === "[]") {
              securityIsPublic = true
              op.security = []
            } else if (rest.startsWith("[")) {
              op.security = [...rest.matchAll(/([A-Za-z][\w]*)\s*:\s*\[\]/g)].map((m) => m[1])
            } else {
              i += 1
              while (i < lines.length && lines[i].startsWith("        - ")) {
                const name = lines[i].trim().replace(/^- /, "").replace(/:\s*\[\]\s*$/, "").trim()
                if (name) op.security.push(name)
                i += 1
              }
              continue
            }
          } else if (ol.startsWith("        \"") && ol.includes("description:")) {
            const code = ol.match(/"(\d+)"/)?.[1]
            const desc = ol.includes("{ $ref")
              ? "ошибка"
              : unquote(ol.replace(/^.*description:\s*/, "").replace(/}\s*$/, ""))
            if (code) op.responses.push({ code, description: desc })
          } else if (ol.match(/^\s{8}"\d+":/)) {
            const code = ol.match(/"(\d+)"/)?.[1] || ""
            i += 1
            let desc = ""
            if (lines[i]?.trim().startsWith("description:")) {
              desc = unquote(lines[i].replace(/^.*description:\s*/, ""))
            }
            if (code) op.responses.push({ code, description: desc })
          }
          i += 1
        }
        if (securityIsPublic) op.security = []
        else if (op.security.length === 0) op.security = ["cookieAuth"]
        doc.operations.push(op)
      }
      continue
    }
    i += 1
  }

  return doc
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function inlineMd(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
}

function formatDescription(text: string): string {
  const blocks = text.split(/\n\n+/)
  return blocks
    .map((block) => {
      const lines = block.split("\n")
      if (lines.every((l) => l.trim().startsWith("- "))) {
        const items = lines.map((l) => `<li>${inlineMd(l.replace(/^\s*-\s*/, ""))}</li>`).join("")
        return `<ul>${items}</ul>`
      }
      return `<p>${lines.map((l) => inlineMd(l)).join("<br />")}</p>`
    })
    .join("")
}

function authLabel(op: OpenApiOp): string {
  if (op.security.length === 0) return "без авторизации"
  return [...new Set(op.security)].map((s) => SECURITY_LABEL[s] || s).join(" или ")
}

function examplePath(apiPath: string): string {
  return apiPath
    .replace("{documentId}", "42")
    .replace("{username}", "7123456")
    .replace("{id}", "1")
    .replace("{sig}", "e3b0c44298")
}

function curlHeaders(op: OpenApiOp): string[] {
  const h: string[] = []
  if (op.security.includes("cookieAuth")) h.push('-H "Cookie: guard_session=…"')
  if (op.security.includes("moodleApiKey") || op.security.includes("moodleBearer")) {
    h.push('-H "X-API-Key: <MOODLE_API_KEY>"')
    h.push('-H "X-Moodle-Username: 7123456"')
  }
  if (op.security.includes("cronSecret")) h.push('-H "X-Cron-Secret: <CLEANUP_CRON_SECRET>"')
  return h
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

const ERROR_401 = { success: false, error: "Требуется вход" }
const ERROR_400 = { success: false, error: "Некорректный запрос" }
const ERROR_403 = { success: false, error: "Недостаточно прав" }
const OK = { success: true }

function requestBodyExample(op: OpenApiOp): { flag: string; body: string } | null {
  const key = `${op.method} ${op.path}`
  const jsonBodies: Record<string, unknown> = {
    "post /api/auth/login": { username: "admin", password: "secret" },
    "post /api/auth/register": { username: "ivanov", password: "secret12", fullName: "Иванов Иван" },
    "post /api/check": {
      content: "методы поиска похожих документов в корпусе университета ".repeat(4),
      filename: "lab.docx",
      category: "lab",
    },
    "patch /api/documents/{documentId}": { title: "Новое название", category: "lab" },
    "patch /api/documents/{documentId}/status": { status: "final" },
    "patch /api/users/me": { facultyId: "fksis", group: "050501" },
    "post /api/admin/directories": { action: "addFaculty", institutionId: "bsuir", name: "ФКСиС" },
    "post /api/admin/document-types": { institutionId: "bsuir", displayName: "Эссе", name: "essay" },
    "patch /api/admin/document-types/{id}": { displayName: "Лабораторная работа" },
    "post /api/admin/users": { username: "teacher1", password: "secret12", role: "teacher" },
    "patch /api/admin/users/{username}": { role: "teacher", fullName: "Петров П. П." },
    "post /api/report": { filename: "lab.docx", uniquenessPercent: 81.7, documentId: 42, status: "final" },
  }
  if (key in jsonBodies) {
    return { flag: '-H "Content-Type: application/json" \\\n  -d ', body: json(jsonBodies[key]) }
  }
  if (key === "post /api/upload") {
    return {
      flag: "",
      body: '-F "file=@lab.docx" -F "title=Лабораторная" -F "content=текст работы не короче 50 символов" -F "category=lab" -F "username=7123456"',
    }
  }
  return null
}

function successExample(op: OpenApiOp): { code: string; body: string; note?: string } {
  const key = `${op.method} ${op.path}`
  const sessionUser = {
    username: "admin",
    role: "admin",
    fullName: "Администратор",
    institution: "БГУИР",
    institutionId: "bsuir",
  }
  const map: Record<string, { code: string; body: unknown }> = {
    "post /api/auth/login": { code: "200", body: { success: true, user: sessionUser } },
    "post /api/auth/logout": { code: "200", body: OK },
    "get /api/auth/me": { code: "200", body: { success: true, user: sessionUser, idleTimeoutSec: 7200 } },
    "post /api/auth/register": { code: "200", body: { success: true, user: { username: "ivanov", role: "student" } } },
    "post /api/upload": {
      code: "202",
      body: {
        success: true,
        status: "processing",
        jobId: 3,
        document: {
          id: 42,
          title: "Лабораторная",
          category: "lab",
          status: "processing",
          localPlagiarismPercent: 12.5,
        },
      },
    },
    "get /api/documents/{documentId}/analysis": {
      code: "200",
      body: {
        success: true,
        documentId: 42,
        jobStatus: "done",
        documentStatus: "draft",
        originalityPercent: 81.7,
        plagiarismPercent: 18.3,
        aiPercentMl: 7.4,
      },
    },
    "get /api/report/{documentId}/links": {
      code: "200",
      body: {
        success: true,
        verifyUrl: "https://antiplagiat.example/report.html?documentId=42&sig=…",
        originalUrl: "https://antiplagiat.example/api/report/42/original?sig=…",
        reportPdfUrl: "https://antiplagiat.example/api/report/42/download?sig=…",
      },
    },
    "get /api/directories": {
      code: "200",
      body: {
        success: true,
        institutions: [{ id: "bsuir", name: "БГУИР", faculties: [{ id: "fksis", name: "ФКСиС" }] }],
      },
    },
    "get /api/document-types": {
      code: "200",
      body: { success: true, types: [{ id: 1, name: "lab", displayName: "Лабораторная работа", isActive: true }] },
    },
    "delete /api/admin/document-types/{id}": { code: "200", body: { success: true, unlinkedArchived: 0 } },
    "get /api/admin/statistics": {
      code: "200",
      body: {
        success: true,
        statistics: {
          totalDocuments: 120,
          averageUniqueness: 78.4,
          finalsByCategory: [{ category: "lab", count: 40 }],
        },
      },
    },
    "post /api/cron/purge-archived": { code: "200", body: { success: true, purged: 12, filesDeleted: 12 } },
  }
  if (key in map) {
    const row = map[key]
    return { code: row.code, body: json(row.body) }
  }
  if (
    op.path.endsWith("/qr") ||
    op.path.endsWith("/download") ||
    op.path.endsWith("/view") ||
    op.path.endsWith("/original") ||
    op.path.endsWith("/file")
  ) {
    return { code: "200", body: "(бинарное тело: PDF, PNG или исходный файл)", note: "не JSON" }
  }
  if (op.method === "delete") return { code: "200", body: json(OK) }
  return { code: op.responses[0]?.code || "200", body: json(OK) }
}

function errorExample(op: OpenApiOp): { code: string; body: string } {
  if (op.security.length === 0) return { code: "400", body: json(ERROR_400) }
  if (op.security.includes("cookieAuth") || op.security.includes("moodleApiKey") || op.security.includes("cronSecret")) {
    return { code: "401", body: json(ERROR_401) }
  }
  if (op.responses.some((r) => r.code === "403")) return { code: "403", body: json(ERROR_403) }
  return { code: "400", body: json(ERROR_400) }
}

function curlExample(op: OpenApiOp): string {
  let url = `https://antiplagiat.example${examplePath(op.path)}`
  const qs: string[] = []
  if (op.security.includes("qrSignature")) qs.push("sig=e3b0c44298")
  if ((op.security.includes("moodleApiKey") || op.security.includes("moodleBearer")) && op.method === "get") {
    qs.push("username=7123456")
  }
  if (qs.length) url += (url.includes("?") ? "&" : "?") + qs.join("&")
  const headers = curlHeaders(op)
  const body = requestBodyExample(op)
  const parts = [`curl -X ${op.method.toUpperCase()} "${url}"`]
  for (const h of headers) parts.push(`  ${h}`)
  if (body) {
    if (body.flag) parts.push(`  ${body.flag.trimEnd()}'${body.body}'`)
    else parts.push(`  ${body.body}`)
  }
  return parts.join(" \\\n")
}

function examplesHtml(op: OpenApiOp): string {
  const ok = successExample(op)
  const err = errorExample(op)
  return `<div class="ex">
  <p class="resp-label">Пример запроса</p>
  <pre><code>${escapeHtml(curlExample(op))}</code></pre>
  <p class="resp-label">Пример ответа ${escapeHtml(ok.code)}${ok.note ? ` (${escapeHtml(ok.note)})` : ""}</p>
  <pre><code>${escapeHtml(ok.body)}</code></pre>
  <p class="resp-label">Пример ошибки ${escapeHtml(err.code)}</p>
  <pre><code>${escapeHtml(err.body)}</code></pre>
</div>`
}

export function renderOpenApiHtml(doc: OpenApiDoc): string {
  const tagOrder = doc.tags.map((t) => t.name)
  const grouped = new Map<string, OpenApiOp[]>()
  for (const op of doc.operations) {
    const tag = op.tags[0] || "other"
    if (!grouped.has(tag)) grouped.set(tag, [])
    grouped.get(tag)!.push(op)
  }
  const orderedTags = [
    ...tagOrder.filter((t) => grouped.has(t)),
    ...[...grouped.keys()].filter((t) => !tagOrder.includes(t)),
  ]

  const toc = orderedTags
    .map((tag) => {
      const meta = doc.tags.find((t) => t.name === tag)
      return `<li><a href="#tag-${escapeHtml(tag)}">${escapeHtml(tag)}</a>${meta?.description ? ` — ${escapeHtml(meta.description)}` : ""}</li>`
    })
    .join("")

  const body = orderedTags
    .map((tag) => {
      const meta = doc.tags.find((t) => t.name === tag)
      const ops = grouped.get(tag) || []
      const items = ops
        .map((op) => {
          const responses = op.responses
            .map((r) => `<li><code>${escapeHtml(r.code)}</code> — ${escapeHtml(r.description)}</li>`)
            .join("")
          return `<article class="op" id="${escapeHtml(op.method)}-${escapeHtml(op.path).replace(/[^\w]+/g, "-")}">
  <div class="op__head">
    <span class="method method--${escapeHtml(op.method)}">${escapeHtml(op.method.toUpperCase())}</span>
    <code class="op__path">${escapeHtml(op.path)}</code>
    ${op.deprecated ? '<span class="badge">устарел</span>' : ""}
  </div>
  <h3>${inlineMd(op.summary || op.path)}</h3>
  ${op.description ? formatDescription(op.description) : ""}
  <p class="auth"><strong>Доступ:</strong> ${escapeHtml(authLabel(op))}</p>
  ${responses ? `<p class="resp-label">Коды ответов</p><ul class="resp">${responses}</ul>` : ""}
  ${examplesHtml(op)}
</article>`
        })
        .join("\n")
      return `<section id="tag-${escapeHtml(tag)}">
  <h2>${escapeHtml(tag)}</h2>
  ${meta?.description ? `<p class="tag-desc">${escapeHtml(meta.description)}</p>` : ""}
  ${items}
</section>`
    })
    .join("\n")

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${escapeHtml(doc.title)}</title>
  <style>
    :root {
      --primary: #2563eb;
      --ink: #0a1f44;
      --muted: #64748b;
      --bg: #eaf1fb;
      --card: #fff;
      --border: rgba(15, 41, 92, 0.08);
      --font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font);
      color: var(--ink);
      background: var(--bg);
      line-height: 1.55;
    }
    .wrap { max-width: 880px; margin: 0 auto; padding: 32px 20px 80px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    .ver { color: var(--muted); font-size: 14px; margin-bottom: 20px; }
    .note {
      background: #dbeafe;
      border: 1px solid rgba(37, 99, 235, 0.25);
      border-radius: 12px;
      padding: 12px 16px;
      font-size: 14px;
      margin: 0 0 24px;
    }
    .intro p, .intro ul { margin: 0 0 12px; }
    .intro code, code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
      background: #f1f5f9;
      padding: 1px 5px;
      border-radius: 4px;
    }
    nav {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px 20px;
      margin-bottom: 32px;
    }
    nav h2 { font-size: 15px; margin: 0 0 8px; }
    nav ol { margin: 0; padding-left: 20px; }
    nav a { color: var(--primary); text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    section { margin-bottom: 36px; }
    section > h2 {
      font-size: 20px;
      margin: 0 0 6px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border);
    }
    .tag-desc { color: var(--muted); margin: 0 0 16px; }
    .op {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px 18px;
      margin: 0 0 12px;
    }
    .op__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .op__path { font-size: 14px; background: transparent; padding: 0; }
    .op h3 { font-size: 16px; margin: 10px 0 8px; }
    .op p { margin: 0 0 8px; }
    .auth { font-size: 14px; color: var(--muted); }
    .resp-label { font-size: 13px; font-weight: 700; margin: 10px 0 4px !important; }
    .resp { margin: 0; padding-left: 18px; font-size: 14px; color: var(--muted); }
    .ex pre {
      margin: 0 0 12px;
      padding: 12px 14px;
      background: #0a1f44;
      color: #eaf1fb;
      border-radius: 10px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.45;
    }
    .ex pre code { background: transparent; color: inherit; padding: 0; font-size: inherit; }
    .method {
      display: inline-block;
      min-width: 56px;
      text-align: center;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.4px;
      padding: 4px 8px;
      border-radius: 6px;
    }
    .method--get { background: #16a34a; }
    .method--post { background: #2563eb; }
    .method--patch { background: #d97706; }
    .method--put { background: #d97706; }
    .method--delete { background: #dc2626; }
    .badge {
      font-size: 11px;
      font-weight: 700;
      color: #92400e;
      background: #fef3c7;
      padding: 2px 8px;
      border-radius: 999px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(doc.title)}</h1>
    <p class="ver">версия ${escapeHtml(doc.version)}</p>
    <nav>
      <h2>Содержание</h2>
      <ol>${toc}</ol>
    </nav>
    ${body}
  </div>
</body>
</html>
`
}