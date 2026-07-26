/**
 * Idempotent DB seed: УО, факультеты, типы работ, учётные записи по умолчанию.
 * Run: npx prisma db seed
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const INSTITUTIONS = [
  {
    id: "bsuir",
    name: "БГУИР",
    faculties: [
      { id: "fitu", name: "Факультет информационных технологий и управления" },
      { id: "fksis", name: "Факультет компьютерных систем и сетей" },
      { id: "fkaf", name: "Факультет компьютерного проектирования" },
    ],
  },
  {
    id: "bsu",
    name: "БГУ",
    faculties: [
      { id: "bsu_mf", name: "Механико-математический факультет" },
      { id: "bsu_ff", name: "Физический факультет" },
    ],
  },
]

const DEFAULT_INSTITUTION_ID = "bsuir"

const DOCUMENT_TYPES = [
  { name: "diploma", displayName: "Дипломная работа / проект" },
  { name: "coursework", displayName: "Курсовая работа / проект" },
  { name: "lab", displayName: "Лабораторная работа" },
  { name: "practice", displayName: "Практическая работа" },
  { name: "article", displayName: "Статьи" },
]

const DEFAULT_USERS = [
  {
    username: "superadmin",
    password: process.env.SEED_SUPERADMIN_PASSWORD || "BgPlg$S0uper9",
    role: "superadmin",
    fullName: "Главный администратор",
    institutionId: DEFAULT_INSTITUTION_ID,
  },
  {
    username: "admin",
    password: process.env.SEED_ADMIN_PASSWORD || "BgPlg$Adm1n8",
    role: "admin",
    fullName: "Администратор БГУИР",
    institutionId: "bsuir",
  },
  {
    username: "admin_bsu",
    password: process.env.SEED_BSU_ADMIN_PASSWORD || "BgPlg$Bsu8",
    role: "admin",
    fullName: "Администратор БГУ",
    institutionId: "bsu",
  },
  {
    username: "student",
    password: process.env.SEED_STUDENT_PASSWORD || "BgPlg$Stud7",
    role: "student",
    fullName: "Студент Тестовый",
    institutionId: "bsuir",
    facultyId: "fitu",
    groupName: "213801",
  },
  {
    username: "teacher",
    password: process.env.SEED_TEACHER_PASSWORD || "BgPlg$Tchr6",
    role: "teacher",
    fullName: "Преподаватель Тестовый",
    institutionId: "bsuir",
    groupName: "—",
  },
]

/** Найти УО по id или названию; создать с preferredId только если записи ещё нет. */
async function resolveInstitutionId(preferredId, name) {
  const byId = await prisma.institution.findUnique({ where: { id: preferredId } })
  if (byId) {
    if (byId.name !== name) {
      await prisma.institution.update({ where: { id: preferredId }, data: { name } })
    }
    return preferredId
  }
  const byName = await prisma.institution.findFirst({ where: { name } })
  if (byName) return byName.id
  await prisma.institution.create({ data: { id: preferredId, name } })
  return preferredId
}

async function seedInstitutions() {
  const institutionIds = {}
  for (const inst of INSTITUTIONS) {
    const institutionId = await resolveInstitutionId(inst.id, inst.name)
    institutionIds[inst.id] = institutionId
    for (const f of inst.faculties) {
      await prisma.faculty.upsert({
        where: { id: f.id },
        update: { name: f.name, institutionId },
        create: { id: f.id, name: f.name, institutionId },
      })
    }
  }
  return institutionIds
}

async function seedDocumentTypes(institutionIds) {
  for (const institutionId of Object.values(institutionIds)) {
    for (const t of DOCUMENT_TYPES) {
      await prisma.documentType.upsert({
        where: { institutionId_name: { institutionId, name: t.name } },
        update: { displayName: t.displayName, isActive: true },
        create: {
          institutionId,
          name: t.name,
          displayName: t.displayName,
          isActive: true,
        },
      })
    }
  }
}

async function seedUsers(institutionIds) {
  const now = new Date()
  for (const u of DEFAULT_USERS) {
    const logicalInst = u.institutionId ?? DEFAULT_INSTITUTION_ID
    const data = {
      password: u.password,
      role: u.role,
      fullName: u.fullName,
      institutionId: institutionIds[logicalInst] ?? logicalInst,
      facultyId: u.facultyId ?? null,
      groupName: u.groupName ?? null,
    }
    await prisma.user.upsert({
      where: { username: u.username },
      update: data,
      create: {
        username: u.username,
        ...data,
        createdAt: now,
      },
    })
  }
}

async function main() {
  const institutionIds = await seedInstitutions()
  await seedDocumentTypes(institutionIds)
  await seedUsers(institutionIds)
  console.log("Seed completed: institutions, document types, default users.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
