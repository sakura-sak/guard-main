import { type NextRequest, NextResponse } from "next/server"
import { buildAnalysisStateForUser } from "@/lib/analysis-jobs"
import { requireSessionApi } from "@/lib/require-session-api"

/** Active processing job or latest unviewed completed result for the current user. */
export async function GET(request: NextRequest) {
  const gate = await requireSessionApi(request)
  if (!gate.ok) return gate.response

  const state = await buildAnalysisStateForUser(gate.user.username)
  return NextResponse.json({ success: true, ...state })
}
