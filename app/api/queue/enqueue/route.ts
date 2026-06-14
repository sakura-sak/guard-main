import { NextResponse } from "next/server"
import { enqueueJob, startQueueWorker } from "@/lib/queue"

// POST /api/queue/enqueue { type, payload?, runAfterMs? }
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const type = typeof body?.type === "string" ? body.type : ""
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {}
  const runAfterMs = typeof body?.runAfterMs === "number" ? body.runAfterMs : undefined

  if (!type) {
    return NextResponse.json({ success: false, error: "type is required" }, { status: 400 })
  }

  startQueueWorker()
  const { id } = await enqueueJob(type, payload, { runAfterMs })
  return NextResponse.json({ success: true, id })
}

