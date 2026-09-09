import { afterAll, beforeAll, describe, expect, it } from "vitest"
import http from "node:http"
import {
  analyzeWithMlService,
  analyzeWithMlServiceOrThrow,
  getMlJob,
  MlAnalysisError,
  submitMlJob,
} from "@/lib/analysis-client"

let server: http.Server
let port = 0

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = http.createServer((req, res) => {
      const url = req.url || ""
      const chunks: Buffer[] = []
      req.on("data", (c) => chunks.push(c as Buffer))
      req.on("end", () => {
        if (url === "/v1/analyze" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(
            JSON.stringify({
              plagiarism_percent: 11.5,
              ai_percent: 4,
              semantic_matches: [],
              by_type: { exact: 1, paraphrase: 0, semantic: 0 },
            }),
          )
          return
        }
        if (url === "/v1/jobs" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ job_id: "job-42" }))
          return
        }
        if (url.startsWith("v1/jobs/") || url.startsWith("/v1/jobs/")) {
          if (url.includes("missing")) {
            res.writeHead(404)
            res.end("gone")
            return
          }
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(
            JSON.stringify({
              job_id: "job-42",
              status: "completed",
              result: { plagiarism_percent: 9, ai_percent: 2, semantic_matches: [], by_type: { exact: 1 } },
            }),
          )
          return
        }
        res.writeHead(404)
        res.end("no")
      })
    })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (addr && typeof addr === "object") port = addr.port
      resolve()
    })
  })
  process.env.ANALYSIS_SERVICE_URL = `http://127.0.0.1:${port}`
  process.env.ANALYSIS_SERVICE_API_KEY = "test-key"
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
})

describe("analysis-client against a local ML stub", () => {
  it("analyzes, submits and polls a job", async () => {
    const result = await analyzeWithMlServiceOrThrow("текст ".repeat(20), {
      filename: "lab.docx",
      documentId: 42,
      institutionId: "bsuir",
      category: "lab",
      userId: "7123456",
      excludeDocumentIds: [1, 2],
      timeoutMs: 5000,
    })
    expect(result.plagiarismPercent).toBe(11.5)
    expect(result.aiPercent).toBe(4)

    const wrapped = await analyzeWithMlService("ok", { timeoutMs: 5000 })
    expect(wrapped?.plagiarismPercent).toBe(11.5)

    const jobId = await submitMlJob({
      content: "x",
      documentId: 42,
      institutionId: "bsuir",
      category: "lab",
      userId: "7123456",
      excludeDocumentIds: [9],
    })
    expect(jobId).toBe("job-42")

    const status = await getMlJob("job-42")
    expect(status.status).toBe("completed")
    expect(status.result?.plagiarismPercent).toBe(9)
  })

  it("maps missing jobs to retryable errors", async () => {
    await expect(getMlJob("missing")).rejects.toBeInstanceOf(MlAnalysisError)
  })
})
