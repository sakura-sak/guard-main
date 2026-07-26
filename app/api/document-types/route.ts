import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getDocumentTypesForInstitution } from "@/lib/document-types"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    let institutionId = searchParams.get("institutionId")?.trim() || ""
    const institutionName = searchParams.get("institution")?.trim()

    if (!institutionId && institutionName) {
      const inst = await prisma.institution.findFirst({
        where: { name: institutionName, isActive: true },
      })
      institutionId = inst?.id || ""
    }

    if (!institutionId) {
      return NextResponse.json(
        { success: false, error: "Укажите учебное заведение (institutionId или institution)" },
        { status: 400 },
      )
    }

    const types = await getDocumentTypesForInstitution(institutionId, false)
    return NextResponse.json({ success: true, types })
  } catch (error) {
    console.error("Error fetching document types:", error)
    return NextResponse.json({ success: false, error: "Failed to fetch document types" }, { status: 500 })
  }
}
