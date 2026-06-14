import { type NextRequest, NextResponse } from "next/server"
import {
  getDirectories,
  addInstitution,
  updateInstitution,
  deleteInstitution,
  addFaculty,
  updateFaculty,
  deleteFaculty,
} from "@/lib/directories"
import { requireAdminApi } from "@/lib/require-admin-api"

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  const institutions = await getDirectories()
  return NextResponse.json({ success: true, institutions })
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response
  const body = await request.json()
  const { action, institutionId, facultyId, name } = body

  switch (action) {
    case "addInstitution": {
      const r = await addInstitution(String(name || ""))
      return NextResponse.json(r, { status: r.success ? 200 : 400 })
    }
    case "updateInstitution": {
      const r = await updateInstitution(String(institutionId), String(name || ""))
      return NextResponse.json(r, { status: r.success ? 200 : 400 })
    }
    case "deleteInstitution": {
      const r = await deleteInstitution(String(institutionId))
      return NextResponse.json(r, { status: r.success ? 200 : 400 })
    }
    case "addFaculty": {
      const r = await addFaculty(String(institutionId), String(name || ""))
      return NextResponse.json(r, { status: r.success ? 200 : 400 })
    }
    case "updateFaculty": {
      const r = await updateFaculty(String(institutionId), String(facultyId), String(name || ""))
      return NextResponse.json(r, { status: r.success ? 200 : 400 })
    }
    case "deleteFaculty": {
      const r = await deleteFaculty(String(institutionId), String(facultyId))
      return NextResponse.json(r, { status: r.success ? 200 : 400 })
    }
    default:
      return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 })
  }
}
