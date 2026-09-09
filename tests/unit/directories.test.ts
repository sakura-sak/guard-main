import { beforeEach, describe, expect, it } from "vitest"
import { prismaMock, resetPrismaMock } from "../mocks/prisma-mock"
import {
  addFaculty,
  addInstitution,
  activateFaculty,
  activateInstitution,
  deactivateFaculty,
  deactivateInstitution,
  getDirectories,
  getInstitutionById,
  resolveFacultyId,
  resolveInstitutionId,
  updateFaculty,
  updateInstitution,
} from "@/lib/directories"

const inst = {
  id: "bsuir",
  name: "БГУИР",
  isActive: true,
  faculties: [{ id: "fksis", name: "ФКСиС", isActive: true }],
}

describe("directories", () => {
  beforeEach(() => {
    resetPrismaMock()
    prismaMock.institution.count.mockResolvedValue(1)
    prismaMock.institution.findMany.mockResolvedValue([inst])
    prismaMock.institution.findUnique.mockResolvedValue(inst)
    prismaMock.institution.findFirst.mockResolvedValue(inst)
    prismaMock.faculty.findFirst.mockResolvedValue({ id: "fksis", name: "ФКСиС", isActive: true })
    prismaMock.user.count.mockResolvedValue(0)
    prismaMock.document.count.mockResolvedValue(0)
  })

  it("lists institutions after seed check", async () => {
    const list = await getDirectories({ activeOnly: true })
    expect(list[0].id).toBe("bsuir")
    expect(list[0].faculties[0].id).toBe("fksis")
  })

  it("resolves institution and faculty by id or name", async () => {
    expect(await resolveInstitutionId("bsuir")).toBe("bsuir")
    expect(await resolveInstitutionId("")).toBeNull()
    expect(await resolveFacultyId("bsuir", "fksis")).toBe("fksis")
    expect(await resolveFacultyId("bsuir", "")).toBeNull()
  })

  it("adds and reactivates an institution", async () => {
    prismaMock.institution.findUnique.mockResolvedValueOnce(null)
    const created = await addInstitution("Новый вуз", "super")
    expect(created.success).toBe(true)

    prismaMock.institution.findUnique.mockResolvedValueOnce({ id: "old", name: "Старый", isActive: false })
    prismaMock.institution.findUnique.mockResolvedValue(inst)
    const reactivated = await addInstitution("Старый", "super")
    expect(reactivated.success).toBe(true)
  })

  it("rejects empty institution name and duplicate active institution", async () => {
    expect((await addInstitution("  ")).success).toBe(false)
    prismaMock.institution.findUnique.mockResolvedValue({ id: "bsuir", name: "БГУИР", isActive: true })
    expect((await addInstitution("БГУИР")).success).toBe(false)
  })

  it("deactivates institution when unused", async () => {
    const result = await deactivateInstitution("bsuir", "super")
    expect(result.success).toBe(true)
  })

  it("refuses to deactivate institution in use", async () => {
    prismaMock.user.count.mockResolvedValue(3)
    const result = await deactivateInstitution("bsuir")
    expect(result.success).toBe(false)
  })

  it("adds a faculty and deactivates it", async () => {
    prismaMock.faculty.findUnique.mockResolvedValueOnce(null)
    prismaMock.faculty.create.mockResolvedValueOnce({
      id: "novyi-fakultet",
      name: "Новый факультет",
      isActive: true,
    })
    const added = await addFaculty("bsuir", "Новый факультет", "admin")
    expect(added.success).toBe(true)
    prismaMock.faculty.findFirst.mockResolvedValue({
      id: "fksis",
      name: "ФКСиС",
      isActive: true,
      institutionId: "bsuir",
    })
    expect((await deactivateFaculty("bsuir", "fksis", "admin")).success).toBe(true)
  })

  it("returns institution by id", async () => {
    expect((await getInstitutionById("bsuir"))?.name).toBe("БГУИР")
    prismaMock.institution.findUnique.mockResolvedValue(null)
    expect(await getInstitutionById("nope")).toBeNull()
  })

  it("updates and activates institution and faculty", async () => {
    expect((await updateInstitution("bsuir", "БГУИР-2", "super")).success).toBe(true)
    expect((await updateInstitution("bsuir", "  ")).success).toBe(false)
    expect((await activateInstitution("bsuir", "super")).success).toBe(true)
    prismaMock.faculty.findFirst.mockResolvedValue({
      id: "fksis",
      name: "ФКСиС",
      isActive: false,
      institutionId: "bsuir",
    })
    expect((await updateFaculty("bsuir", "fksis", "ФКСиС-2", "admin")).success).toBe(true)
    expect((await activateFaculty("bsuir", "fksis", "admin")).success).toBe(true)
  })
})
