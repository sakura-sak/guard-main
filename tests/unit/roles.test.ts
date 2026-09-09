import { describe, expect, it } from "vitest"
import {
  adminCanChangeUserPassword,
  canAssignRole,
  canSelfCompleteProfile,
  creatableRolesFor,
  isBsuirInstitution,
  isStaffAdmin,
  isStudentOrTeacher,
  isSuperAdmin,
  isUniversityAdmin,
  needsProfileCompletion,
  profileEditPolicy,
} from "@/lib/roles"

describe("roles", () => {
  it("classifies admin roles", () => {
    expect(isSuperAdmin("superadmin")).toBe(true)
    expect(isUniversityAdmin("admin")).toBe(true)
    expect(isStaffAdmin("admin")).toBe(true)
    expect(isStaffAdmin("student")).toBe(false)
    expect(isStudentOrTeacher("teacher")).toBe(true)
    expect(isStudentOrTeacher("admin")).toBe(false)
  })

  it("recognizes BSUIR by id or name", () => {
    expect(isBsuirInstitution("bsuir")).toBe(true)
    expect(isBsuirInstitution(undefined, "БГУИР")).toBe(true)
    expect(isBsuirInstitution("bgu", "БГУ")).toBe(false)
  })

  it("forbids changing BSUIR passwords from admin UI", () => {
    expect(adminCanChangeUserPassword("bsuir")).toBe(false)
    expect(adminCanChangeUserPassword("bgu")).toBe(true)
  })

  it("limits which roles an actor may assign", () => {
    expect(creatableRolesFor("superadmin")).toContain("admin")
    expect(creatableRolesFor("admin")).toEqual(["teacher", "student"])
    expect(creatableRolesFor("student")).toEqual([])
    expect(canAssignRole("admin", "superadmin")).toBe(false)
    expect(canAssignRole("admin", "student")).toBe(true)
  })

  it("requires faculty and group for BSUIR students", () => {
    expect(needsProfileCompletion("student", "bsuir", "БГУИР", "ФКСиС", "050501")).toBe(false)
    expect(needsProfileCompletion("student", "bsuir", "БГУИР", "", "050501")).toBe(true)
    expect(needsProfileCompletion("admin", "bsuir")).toBe(false)
    expect(needsProfileCompletion("student")).toBe(true)
  })

  it("lets BSUIR students complete faculty/group themselves", () => {
    expect(canSelfCompleteProfile("student", "bsuir")).toBe(true)
    expect(canSelfCompleteProfile("student", "bgu")).toBe(false)
    expect(canSelfCompleteProfile("admin", "bsuir")).toBe(false)
  })

  it("locks institution field for BSUIR student profile", () => {
    const policy = profileEditPolicy("student", "bsuir", "БГУИР")
    expect(policy.institution).toBe(false)
    expect(policy.faculty).toBe(true)
    expect(policy.group).toBe(true)
  })
})
