/**
 * Guard analysis worker — claims durable AnalysisJob rows,
 * submits once to ML POST /v1/jobs, then polls GET /v1/jobs/{id}.
 * No long-held HTTP connection to ML.
 */

import fs from "fs"
import path from "path"
import {
  attachMlJobId,
  claimNextAnalysisJob,
  clearMlJobId,
  completeAnalysisJob,
  failOrRetryAnalysisJob,
  getAnalysisQueueStats,
  MAX_ANALYSIS_ATTEMPTS,
  purgeTerminalAnalysisJobs,
  renewAnalysisJobLease,
  type ClaimedAnalysisJob,
} from "@/lib/analysis-jobs"
import { getMlJob, MlAnalysisError, submitMlJob } from "@/lib/analysis-client"
import { logError, logInfo } from "@/lib/logger"
import { prisma } from "@/lib/prisma"

const HEARTBEAT_FILE = process.env.ANALYSIS_WORKER_HEARTBEAT_FILE?.trim()
  || path.join("/tmp", "analysis-worker-heartbeat")

const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
const POLL_IDLE_MS = Number(process.env.ANALYSIS_WORKER_POLL_MS || 2000)
const ML_POLL_MS = Number(process.env.ANALYSIS_ML_POLL_MS || 5000)
const DISPATCH_CONCURRENCY = Math.max(1, Number(process.env.ANALYSIS_DISPATCH_CONCURRENCY || 8))
/** Max wall time waiting for one ML job (submit once, poll until done). */
const JOB_WAIT_MS = Number(process.env.ANALYSIS_WORKER_TIMEOUT_MS || 3_600_000)
const HEARTBEAT_MS = 30_000
const PURGE_EVERY_MS = 6 * 60 * 60 * 1000

let shuttingDown = false
let lastHeartbeatAt = Date.now()
let lastPurgeAt = 0
const running = new Set<Promise<void>>()

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Other documents by the same user — excluded from ML comparison (incl. legacy Qdrant points without user_id). */
async function siblingDocumentIds(userId: string, excludeDocumentId: number): Promise<number[]> {
  const uid = userId?.trim()
  if (!uid) return []
  const rows = await prisma.document.findMany({
    where: { userId: uid, id: { not: excludeDocumentId } },
    select: { id: true },
    orderBy: { id: "desc" },
    take: 500,
  })
  return rows.map((r) => r.id)
}

async function ensureMlJob(job: ClaimedAnalysisJob, startedAt: number): Promise<string> {
  if (job.mlJobId) return job.mlJobId

  if (!job.content || job.content.length < 50) {
    throw new MlAnalysisError("Document content missing or too short", false)
  }

  // Wait out ML cold-start (model download/load) without burning retry attempts.
  while (!shuttingDown) {
    if (Date.now() - startedAt > JOB_WAIT_MS) {
      throw new MlAnalysisError(`ML not ready within wait limit ${JOB_WAIT_MS}ms`, true)
    }
    try {
      const excludeDocumentIds = await siblingDocumentIds(job.userId, job.documentId)
      const mlJobId = await submitMlJob({
        content: job.content,
        filename: job.filename || "document.txt",
        documentId: job.documentId,
        institutionId: job.institutionId || undefined,
        category: job.category,
        userId: job.userId,
        excludeDocumentIds,
      })
      await attachMlJobId(job.id, mlJobId)
      job.mlJobId = mlJobId
      job.attempts += 1
      return mlJobId
    } catch (e) {
      if (e instanceof MlAnalysisError && e.statusCode === 503) {
        logInfo("ML still loading models — waiting to submit", job.userId, undefined, "analysis_worker", {
          jobId: job.id,
          documentId: job.documentId,
          waitMs: Date.now() - startedAt,
        })
        await renewAnalysisJobLease(job.id)
        await sleep(Math.max(ML_POLL_MS, 10_000))
        continue
      }
      throw e
    }
  }
  throw new MlAnalysisError("Worker shutting down before ML submit", true)
}

async function runClaimedJob(job: ClaimedAnalysisJob): Promise<void> {
  const startedAt = Date.now()
  logInfo("Analysis job claimed", job.userId, undefined, "analysis_worker", {
    workerId: WORKER_ID,
    jobId: job.id,
    documentId: job.documentId,
    institutionId: job.institutionId,
    attempts: job.attempts,
    mlJobId: job.mlJobId,
  })

  try {
    let mlJobId = await ensureMlJob(job, startedAt)

    while (!shuttingDown) {
      if (Date.now() - startedAt > JOB_WAIT_MS) {
        throw new MlAnalysisError(`ML job exceeded wait limit ${JOB_WAIT_MS}ms`, true)
      }

      await renewAnalysisJobLease(job.id)

      let status
      try {
        status = await getMlJob(mlJobId)
      } catch (e) {
        // Transient poll errors: keep waiting, do not requeue / resubmit.
        if (e instanceof MlAnalysisError && e.statusCode === 404) {
          // ML restarted and lost in-memory job — resubmit once if attempts remain.
          if (job.attempts >= MAX_ANALYSIS_ATTEMPTS) {
            throw new MlAnalysisError("ML job lost after restart; max attempts reached", false)
          }
          logInfo("ML job missing — resubmitting once", job.userId, undefined, "analysis_worker", {
            jobId: job.id,
            documentId: job.documentId,
            oldMlJobId: mlJobId,
            attempts: job.attempts,
          })
          await clearMlJobId(job.id, "ML job 404; resubmit")
          job.mlJobId = null
          mlJobId = await ensureMlJob(job, startedAt)
          await sleep(ML_POLL_MS)
          continue
        }
        logError(
          "ML poll error (will retry poll)",
          e instanceof Error ? e : String(e),
          job.userId,
          undefined,
          "analysis_worker",
          { jobId: job.id, mlJobId, documentId: job.documentId },
        )
        await sleep(ML_POLL_MS)
        continue
      }

      if (status.status === "queued" || status.status === "processing") {
        await sleep(ML_POLL_MS)
        continue
      }

      if (status.status === "failed") {
        throw new MlAnalysisError(status.error || "ML job failed", true)
      }

      if (status.status === "completed" && status.result) {
        await completeAnalysisJob({
          jobId: job.id,
          documentId: job.documentId,
          plagiarismPercentMl: status.result.plagiarismPercent,
          aiPercentMl: status.result.aiPercent,
          localPlagiarismPercent: job.localPlagiarismPercent,
          processingTimeMs: Date.now() - startedAt,
          semanticMatches: status.result.semanticMatches,
        })
        logInfo("Analysis job completed", job.userId, undefined, "analysis_worker", {
          workerId: WORKER_ID,
          jobId: job.id,
          documentId: job.documentId,
          mlJobId,
          durationMs: Date.now() - startedAt,
          plagiarismPercent: status.result.plagiarismPercent,
          aiPercent: status.result.aiPercent,
          semanticMatchCount: status.result.semanticMatches.length,
          byType: status.result.byType,
        })
        return
      }

      throw new MlAnalysisError(`Unexpected ML job status: ${status.status}`, true)
    }
  } catch (e) {
    if (shuttingDown) {
      // Leave job leased/queued for another worker — do not burn attempts on shutdown.
      logInfo("Worker shutting down; leaving job for reclaim", job.userId, undefined, "analysis_worker", {
        jobId: job.id,
        documentId: job.documentId,
        mlJobId: job.mlJobId,
      })
      return
    }
    const msg = e instanceof Error ? e.message : String(e)
    const retryable = e instanceof MlAnalysisError ? e.retryable : true
    // Resubmit only when ML reported failure / submit failed — not on wait-limit
    // (that would stack duplicate ML work while the previous job may still run).
    const shouldResubmit =
      retryable &&
      !(e instanceof MlAnalysisError && /exceeded wait limit/i.test(e.message))
    if (shouldResubmit) {
      await clearMlJobId(job.id, msg).catch(() => undefined)
    }
    const outcome = await failOrRetryAnalysisJob({
      jobId: job.id,
      documentId: job.documentId,
      attempts: retryable ? Math.max(job.attempts, 1) : Number.MAX_SAFE_INTEGER,
      error: msg,
    })

    logError("Analysis job failed", msg, job.userId, undefined, "analysis_worker", {
      workerId: WORKER_ID,
      jobId: job.id,
      documentId: job.documentId,
      attempts: job.attempts,
      outcome,
      retryable,
    })
  }
}

async function heartbeat() {
  const stats = await getAnalysisQueueStats()
  lastHeartbeatAt = Date.now()
  try {
    fs.writeFileSync(
      HEARTBEAT_FILE,
      JSON.stringify({
        workerId: WORKER_ID,
        at: new Date().toISOString(),
        inFlight: running.size,
        ...stats,
      }),
    )
  } catch {
    /* ignore */
  }
  // Heartbeat is for Docker healthcheck (file mtime) — do not write to audit_logs.
  console.log(
    `[analysis-worker] heartbeat workerId=${WORKER_ID} inFlight=${running.size}`,
    stats,
  )
}

async function maybePurge() {
  if (Date.now() - lastPurgeAt < PURGE_EVERY_MS) return
  lastPurgeAt = Date.now()
  try {
    const deleted = await purgeTerminalAnalysisJobs(30)
    if (deleted > 0) {
      logInfo("Purged terminal analysis jobs", undefined, undefined, "analysis_worker", {
        workerId: WORKER_ID,
        deleted,
      })
    }
  } catch (e) {
    logError("Purge terminal jobs failed", e instanceof Error ? e : String(e), undefined, undefined, "analysis_worker")
  }
}

async function main() {
  logInfo("Analysis worker starting", undefined, undefined, "analysis_worker", {
    workerId: WORKER_ID,
    dispatchConcurrency: DISPATCH_CONCURRENCY,
    pollIdleMs: POLL_IDLE_MS,
    mlPollMs: ML_POLL_MS,
    jobWaitMs: JOB_WAIT_MS,
    mode: "submit_and_poll",
  })

  const onSignal = (sig: string) => {
    if (shuttingDown) return
    shuttingDown = true
    logInfo(`Analysis worker shutting down (${sig})`, undefined, undefined, "analysis_worker", {
      workerId: WORKER_ID,
      inFlight: running.size,
    })
  }
  process.on("SIGINT", () => onSignal("SIGINT"))
  process.on("SIGTERM", () => onSignal("SIGTERM"))

  await heartbeat()

  while (!shuttingDown || running.size > 0) {
    if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
      try {
        await heartbeat()
      } catch (e) {
        logError("Heartbeat failed", e instanceof Error ? e : String(e), undefined, undefined, "analysis_worker")
      }
    }

    await maybePurge()

    if (shuttingDown) {
      if (running.size === 0) break
      await sleep(500)
      continue
    }

    let claimedAny = false
    while (!shuttingDown && running.size < DISPATCH_CONCURRENCY) {
      const job = await claimNextAnalysisJob(WORKER_ID)
      if (!job) break
      claimedAny = true
      const p = runClaimedJob(job)
        .catch((e) => {
          logError(
            "Unexpected worker error",
            e instanceof Error ? e : String(e),
            undefined,
            undefined,
            "analysis_worker",
          )
        })
        .finally(() => {
          running.delete(p)
        })
      running.add(p)
    }

    if (!claimedAny && running.size === 0) {
      await sleep(POLL_IDLE_MS)
    } else {
      await sleep(100)
    }
  }

  logInfo("Analysis worker stopped", undefined, undefined, "analysis_worker", { workerId: WORKER_ID })
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
