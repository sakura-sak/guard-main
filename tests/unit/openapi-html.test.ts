import { describe, expect, it } from "vitest"
import { loadOpenApiYaml, parseOpenApiYaml, renderOpenApiHtml } from "@/lib/openapi-html"

describe("openapi html reference", () => {
  it("parses all path operations from the spec", () => {
    const doc = parseOpenApiYaml(loadOpenApiYaml())
    expect(doc.title).toMatch(/Guard API/)
    expect(doc.operations.length).toBeGreaterThan(40)
    const upload = doc.operations.find((op) => op.method === "post" && op.path === "/api/upload")
    expect(upload?.summary).toMatch(/Загрузка/)
    expect(upload?.security).toEqual(expect.arrayContaining(["cookieAuth", "moodleApiKey"]))
    const login = doc.operations.find((op) => op.path === "/api/auth/login")
    expect(login?.security).toEqual([])
  })

  it("renders request and response examples", () => {
    const html = renderOpenApiHtml(parseOpenApiYaml(loadOpenApiYaml()))
    expect(html).toContain("POST")
    expect(html).toContain("/api/upload")
    expect(html).toContain("Пример запроса")
    expect(html).toContain("curl -X POST")
    expect(html).toContain("Пример ответа")
    expect(html).not.toContain("Это справочник методов")
    expect(html).not.toContain("Аудитории")
    expect(html).not.toMatch(/swagger/i)
  })
})
