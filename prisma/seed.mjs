/**
 * Idempotent DB seed: БГУИР, faculties, document types, default role accounts.
 * Run: npx prisma db seed
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const INSTITUTION = {
  id: "bsuir",
  name: "БГУИР",
  faculties: [
    { id: "fitu", name: "Факультет информационных технологий и управления" },
    { id: "fksis", name: "Факультет компьютерных систем и сетей" },
    { id: "fkaf", name: "Факультет компьютерного проектирования" },
  ],
}

const DOCUMENT_TYPES = [
  { name: "diploma", displayName: "Дипломная работа / проект" },
  { name: "coursework", displayName: "Курсовая работа / проект" },
  { name: "lab", displayName: "Лабораторная работа" },
  { name: "practice", displayName: "Практическая работа" },
  { name: "article", displayName: "Статьи" },
]

const DEFAULT_USERS = [
  { username: "superadmin", password: "superadmin", role: "superadmin", fullName: "Главный администратор" },
  { username: "admin", password: "admin", role: "admin", fullName: "Администратор БГУИР" },
  { username: "student", password: "student", role: "student", fullName: "Студент Тестовый", facultyId: "fitu", groupName: "213801" },
  { username: "teacher", password: "teacher", role: "teacher", fullName: "Преподаватель Тестовый", groupName: "—" },
]

async function seedInstitution() {
  await prisma.institution.upsert({
    where: { id: INSTITUTION.id },
    update: { name: INSTITUTION.name },
    create: { id: INSTITUTION.id, name: INSTITUTION.name },
  })
  for (const f of INSTITUTION.faculties) {
    await prisma.faculty.upsert({
      where: { id: f.id },
      update: { name: f.name, institutionId: INSTITUTION.id },
      create: { id: f.id, name: f.name, institutionId: INSTITUTION.id },
    })
  }
}

async function seedDocumentTypes() {
  for (const t of DOCUMENT_TYPES) {
    await prisma.documentType.upsert({
      where: { name: t.name },
      update: { displayName: t.displayName, isActive: true },
      create: { name: t.name, displayName: t.displayName, isActive: true },
    })
  }
}

async function seedUsers() {
  const now = new Date()
  for (const u of DEFAULT_USERS) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: {
        role: u.role,
        fullName: u.fullName,
        institutionId: INSTITUTION.id,
        facultyId: u.facultyId ?? null,
        groupName: u.groupName ?? null,
      },
      create: {
        username: u.username,
        password: u.password,
        role: u.role,
        fullName: u.fullName,
        institutionId: INSTITUTION.id,
        facultyId: u.facultyId ?? null,
        groupName: u.groupName ?? null,
        createdAt: now,
      },
    })
  }
}

async function main() {
  await seedInstitution()
  await seedDocumentTypes()
  await seedUsers()
  console.log("Seed completed: institution, document types, default users.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
