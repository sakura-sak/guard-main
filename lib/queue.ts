import crypto from "crypto"
import { prisma } from "./prisma"
import { ensureSqliteSeededFromLocalJson } from "./sqlite-seed"

export type JobStatus = "queued" | "running" | "succeeded" | "failed"

export interface JobRow<TPayload = any, TResult = any> {
  id: number
  type: string
  payload: TPayload
  status: JobStatus
  result?: TResult
  error?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  attempts: number
  maxAttempts: number
  runAfterMs?: number | null
}

async function initDb() {
  await ensureSqliteSeededFromLocalJson()
  return prisma
}

function nowIso() {
  return new Date().toISOString()
}

function mapJobRow(row: any): JobRow {
  return {
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payloadJson),
    status: row.status,
    result: row.resultJson ? JSON.parse(row.resultJson) : undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    startedAt: row.startedAt ? row.startedAt.toISOString() : undefined,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : undefined,
    attempts: row.attempts ?? 0,
    maxAttempts: row.maxAttempts ?? 3,
    runAfterMs: row.runAfterMs ?? null,
  }
}

export async function enqueueJob<TPayload extends object>(
  type: string,
  payload: TPayload,
  opts?: { runAfterMs?: number; maxAttempts?: number },
): Promise<{ id: number }> {
  const db = await initDb()
  const runAfterMs = typeof opts?.runAfterMs === "number" ? opts.runAfterMs : null
  const maxAttempts = typeof opts?.maxAttempts === "number" ? opts.maxAttempts : 3
  const created = await db.job.create({
    data: {
      type,
      payloadJson: JSON.stringify(payload ?? {}),
      status: "queued",
      createdAt: new Date(nowIso()),
      attempts: 0,
      maxAttempts,
      runAfterMs,
    },
  })
  return { id: created.id }
}

export async function getJobById(id: number): Promise<JobRow | null> {
  const db = await initDb()
  const row = await db.job.findUnique({ where: { id } })
  return row ? mapJobRow(row) : null
}

export async function listJobs(opts?: { status?: JobStatus; limit?: number }): Promise<JobRow[]> {
  const db = await initDb()
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 500)
  const rows = await db.job.findMany({
    where: opts?.status ? { status: opts.status } : undefined,
    orderBy: { id: "desc" },
    take: limit,
  })
  return rows.map(mapJobRow)
}

type Handler = (payload: any) => Promise<any> | any

const handlers: Record<string, Handler> = {
  noop: async (payload: any) => ({ ok: true, payload }),
}

export function registerJobHandler(type: string, handler: Handler) {
  handlers[type] = handler
}

function randomWorkerId(): string {
  return crypto.randomBytes(8).toString("hex")
}

async function claimNextJob(workerId: string, lockTtlMs: number): Promise<any | null> {
  const db = await initDb()
  const now = Date.now()
  const expiredBefore = now - lockTtlMs

  const row = await db.job.findFirst({
    where: {
      status: "queued",
      AND: [{ OR: [{ runAfterMs: null }, { runAfterMs: { lte: now } }] }, { OR: [{ lockedAtMs: null }, { lockedAtMs: { lt: expiredBefore } }] }],
    },
    orderBy: { id: "asc" },
  })
  if (!row) return null

  const updated = await db.job.updateMany({
    where: { id: row.id, status: "queued" },
    data: {
      status: "running",
      startedAt: row.startedAt ?? new Date(nowIso()),
      lockedBy: workerId,
      lockedAtMs: now,
      attempts: { increment: 1 },
    },
  })
  if (updated.count !== 1) return null
  return db.job.findUnique({ where: { id: row.id } })
}

async function completeJob(id: number, result: any) {
  const db = await initDb()
  await db.job.updateMany({
    where: { id },
    data: {
      status: "succeeded",
      resultJson: JSON.stringify(result ?? null),
      finishedAt: new Date(nowIso()),
      lockedBy: null,
      lockedAtMs: null,
    },
  })
}

async function failJob(id: number, error: string, retryDelayMs: number | null) {
  const db = await initDb()
  const job = await db.job.findUnique({ where: { id }, select: { attempts: true, maxAttempts: true } })
  const attempts = job?.attempts ?? 1
  const maxAttempts = job?.maxAttempts ?? 3
  const shouldRetry = attempts < maxAttempts && retryDelayMs != null
  if (shouldRetry) {
    await db.job.updateMany({
      where: { id },
      data: {
        status: "queued",
        error,
        lockedBy: null,
        lockedAtMs: null,
        runAfterMs: Date.now() + retryDelayMs,
      },
    })
    return
  }

  await db.job.updateMany({
    where: { id },
    data: {
      status: "failed",
      error,
      finishedAt: new Date(nowIso()),
      lockedBy: null,
      lockedAtMs: null,
    },
  })
}

let _workerStarted = false
let _workerId: string | null = null

export function startQueueWorker(opts?: { pollIntervalMs?: number; lockTtlMs?: number }) {
  if (_workerStarted) return
  _workerStarted = true
  _workerId = randomWorkerId()

  const pollIntervalMs = Math.min(Math.max(opts?.pollIntervalMs ?? 500, 100), 5000)
  const lockTtlMs = Math.min(Math.max(opts?.lockTtlMs ?? 60_000, 5_000), 10 * 60_000)

  const tick = async () => {
    try {
      const row = await claimNextJob(_workerId!, lockTtlMs)
      if (!row) return

      const job = mapJobRow(row)
      const handler = handlers[job.type]
      if (!handler) {
        await failJob(job.id, `No handler registered for type: ${job.type}`, null)
        return
      }

      const result = await handler(job.payload)
      await completeJob(job.id, result)
    } catch (err) {
      // swallow; next tick will retry
    }
  }

  // eslint-disable-next-line no-undef
  setInterval(() => void tick(), pollIntervalMs)
}

