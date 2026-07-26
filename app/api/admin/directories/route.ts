import { type NextRequest, NextResponse } from "next/server"
import {
  getDirectories,
  addInstitution,
  updateInstitution,
  deactivateInstitution,
  activateInstitution,
  addFaculty,
  updateFaculty,
  deactivateFaculty,
  activateFaculty,
} from "@/lib/directories"
import { assertInstitutionAccess, requireAdminApi, requireSuperAdminApi } from "@/lib/require-admin-api"

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response

  let institutions = await getDirectories({ activeOnly: false })
  if (gate.isUniversityAdmin && gate.institutionId) {
    institutions = institutions.filter((i) => i.id === gate.institutionId)
  }

  return NextResponse.json({ success: true, institutions })
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request)
  if (!gate.ok) return gate.response

  const body = await request.json()
  const { action, institutionId, facultyId, name } = body
  const actor = gate.username

  switch (action) {
    case "addInstitution":
    case "updateInstitution":
    case "deactivateInstitution":
    case "activateInstitution":
    case "deleteInstitution": {
      const superGate = await requireSuperAdminApi(request)
      if (!superGate.ok) return superGate.response
      if (action === "addInstitution") {
        const r = await addInstitution(String(name || ""), actor)
        return NextResponse.json(r, { status: r.success ? 200 : 400 })
      }
      if (action === "updateInstitution") {
        const r = await updateInstitution(String(institutionId), String(name || ""), actor)
        return NextResponse.json(r, { status: r.success ? 200 : 400 })
      }
      if (action === "activateInstitution") {
        const r = await activateInstitution(String(institutionId), actor)
        return NextResponse.json(r, { status: r.success ? 200 : 400 })
      }
      const r = await deactivateInstitution(String(institutionId), actor)
      return NextResponse.json(r, { status: r.success ? 200 : 400 })
    }
    case "addFaculty": {
      const denied = assertInstitutionAccess(gate, String(institutionId))
      if (denied) return denied
      const r = await addFaculty(String(institutionId), String(name || ""), actor)
      return NextResponse.json(r, { status: r.success ? 200 : 400 })
    }
    case "updateFaculty": {
      const denied = assertInstitutionAccess(gate, String(institutionId))
      if (denied) return denied
      const r = await updateFaculty(String(institutionId), String(facultyId), String(name || ""), actor)
      return NextResponse.json(r, { status: r.success ? 200 : 400 })
    }
    case "deactivateFaculty":
    case "deleteFaculty": {
      const denied = assertInstitutionAccess(gate, String(institutionId))
      if (denied) return denied
      const r = await deactivateFaculty(String(institutionId), String(facultyId), actor)
      return NextResponse.json(r, { status: r.success ? 200 : 400 })
    }
    case "activateFaculty": {
      const denied = assertInstitutionAccess(gate, String(institutionId))
      if (denied) return denied
      const r = await activateFaculty(String(institutionId), String(facultyId), actor)
      return NextResponse.json(r, { status: r.success ? 200 : 400 })
    }
    default:
      return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 })
  }
}
