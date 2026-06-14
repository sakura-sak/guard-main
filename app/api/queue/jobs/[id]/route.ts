import { NextResponse } from "next/server"
import { getJobById, startQueueWorker } from "@/lib/queue"

// GET /api/queue/jobs/:id
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const jobId = Number.parseInt(id, 10)
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ success: false, error: "invalid id" }, { status: 400 })
  }

  startQueueWorker()
  const job = await getJobById(jobId)
  if (!job) return NextResponse.json({ success: false, error: "not found" }, { status: 404 })
  return NextResponse.json({ success: true, job })
}

