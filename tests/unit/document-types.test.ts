import { beforeEach, describe, expect, it } from "vitest"
import { prismaMock, resetPrismaMock } from "../mocks/prisma-mock"
import {
  createDocumentType,
  ensureDocumentTypesForInstitution,
  getAllDocumentTypes,
  getDocumentTypeById,
  getDocumentTypesForInstitution,
  normalizeCategorySlug,
  resolveDocumentTypeId,
  slugifyDocumentTypeName,
  updateDocumentType,
  deactivateDocumentType,
  deleteDocumentType,
} from "@/lib/document-types"

const typeRow = {
  id: 3,
  institutionId: "bsuir",
  name: "lab",
  displayName: "Лабораторная работа",
  description: null,
  isActive: true,
}

describe("document-types", () => {
  beforeEach(() => {
    resetPrismaMock()
    prismaMock.documentType.count.mockResolvedValue(1)
    prismaMock.institution.findMany.mockResolvedValue([{ id: "bsuir", isActive: true }])
    prismaMock.documentType.findMany.mockResolvedValue([typeRow])
    prismaMock.documentType.findUnique.mockResolvedValue(typeRow)
    prismaMock.institution.findUnique.mockResolvedValue({ id: "bsuir", name: "БГУИР", isActive: true })
  })

  it("slugifies and normalizes category names", () => {
    expect(slugifyDocumentTypeName("Курсовая работа")).toBe("курсовая_работа")
    expect(normalizeCategorySlug("lab!!!")).toBe("lab___")
    expect(normalizeCategorySlug("")).toBe("uncategorized")
  })

  it("resolves type id for an institution", async () => {
    expect(await resolveDocumentTypeId(null, "lab")).toBeNull()
    expect(await resolveDocumentTypeId("bsuir", "uncategorized")).toBeNull()
    expect(await resolveDocumentTypeId("bsuir", "lab")).toBe(3)
  })

  it("lists and fetches types", async () => {
    const all = await getAllDocumentTypes(false, "bsuir")
    expect(all[0].name).toBe("lab")
    expect((await getDocumentTypesForInstitution("bsuir"))[0].id).toBe(3)
    expect((await getDocumentTypeById(3))?.displayName).toBe("Лабораторная работа")
  })

  it("seeds default types when an institution has none", async () => {
    prismaMock.documentType.count.mockResolvedValueOnce(0)
    await ensureDocumentTypesForInstitution("bsuir")
    expect(prismaMock.documentType.create).toHaveBeenCalled()
  })

  it("creates a document type", async () => {
    prismaMock.institution.findUnique.mockResolvedValue({ id: "bsuir", name: "БГУИР", isActive: true })
    prismaMock.documentType.findUnique.mockResolvedValue(null)
    prismaMock.documentType.create.mockResolvedValue({
      ...typeRow,
      name: "esse",
      displayName: "Эссе",
    })
    const created = await createDocumentType(
      { institutionId: "bsuir", displayName: "Эссе", name: "esse" },
      "super",
    )
    expect(created.success).toBe(true)
    expect((await createDocumentType({ institutionId: "", displayName: "X" })).success).toBe(false)
  })

  it("updates and deactivates a type", async () => {
    prismaMock.document.count.mockResolvedValue(0)
    prismaMock.documentType.update.mockResolvedValue({ ...typeRow, displayName: "Лаб." })
    const updated = await updateDocumentType(3, { displayName: "Лаб.", description: "x", isActive: true }, "super")
    expect(updated.success).toBe(true)
    expect((await updateDocumentType(3, { displayName: "" })).success).toBe(false)
    prismaMock.documentType.findUnique.mockResolvedValueOnce(null)
    expect((await updateDocumentType(99, { displayName: "X" })).success).toBe(false)

    const deactivated = await deactivateDocumentType(3, "super")
    expect(deactivated.success).toBe(true)
    prismaMock.document.count.mockResolvedValueOnce(4)
    expect((await deactivateDocumentType(3)).success).toBe(false)
    expect((await deleteDocumentType(3)).success).toBe(true)
  })
})
