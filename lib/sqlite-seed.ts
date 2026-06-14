import fs from "fs"
import path from "path"
import { prisma } from "./prisma"

type JsonUserDb = { users: any[] }
type JsonCategoryDb = { documents: any[] }

const DATA_DIR = path.join(process.cwd(), "data")

function readJsonIfExists<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null
  const raw = fs.readFileSync(filePath, "utf-8")
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function listCategoryDocumentFiles(): Array<{ category: string; filePath: string }> {
  if (!fs.existsSync(DATA_DIR)) return []
  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true })
  const out: Array<{ category: string; filePath: string }> = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const name = e.name
    if (name.startsWith("_") || name === "reports" || name === "uploads") continue
    const fp = path.join(DATA_DIR, name, "documents.json")
    if (fs.existsSync(fp)) out.push({ category: name, filePath: fp })
  }
  return out
}

function normalizeCategory(cat: string): string {
  return cat.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, "_").trim() || "uncategorized"
}

export async function ensureSqliteSeededFromLocalJson() {
  const [documentsCount, usersCount] = await Promise.all([prisma.document.count(), prisma.user.count()])

  // Seed only when both tables are empty (first run)
  if (documentsCount > 0 || usersCount > 0) return

  const usersJsonPath = path.join(DATA_DIR, "users.json")
  const usersDb = readJsonIfExists<JsonUserDb>(usersJsonPath)

  const categoryFiles = listCategoryDocumentFiles()

  for (const u of usersDb?.users ?? []) {
    const username = String(u.username ?? "").trim()
    if (!username) continue
    await prisma.user.upsert({
      where: { username },
      update: {},
      create: {
        username,
        password: String(u.password ?? ""),
        role: String(u.role ?? "student"),
        additionalRolesJson: u.additionalRoles ? JSON.stringify(u.additionalRoles) : null,
        email: u.email ?? null,
        fullName: u.fullName ?? null,
        institution: u.institution ?? null,
        createdAt: u.createdAt ? new Date(u.createdAt) : new Date(),
        lastLogin: u.lastLogin ? new Date(u.lastLogin) : null,
      },
    })
  }

  for (const { category, filePath } of categoryFiles) {
    const json = readJsonIfExists<JsonCategoryDb>(filePath)
    for (const d of json?.documents ?? []) {
      const cat = normalizeCategory(String(d.category ?? category))
      const minhash = Array.isArray(d.minhashSignature) ? d.minhashSignature : []
      const id = typeof d.id === "number" ? d.id : Number.parseInt(String(d.id), 10)
      if (!Number.isFinite(id)) continue

      const exists = await prisma.document.findUnique({ where: { id }, select: { id: true } })
      if (exists) continue

      await prisma.document.create({
        data: {
          id,
          title: String(d.title ?? ""),
          author: d.author ?? null,
          filename: d.filename ?? null,
          filePath: d.filePath ?? null,
          content: String(d.content ?? ""),
          wordCount:
            typeof d.wordCount === "number"
              ? d.wordCount
              : String(d.content ?? "")
                  .split(/\s+/)
                  .filter((w: string) => w.length > 0).length,
          uploadDate: d.uploadDate ? new Date(d.uploadDate) : new Date(),
          category: cat,
          status: d.status ?? "draft",
          userId: d.userId ?? null,
          institution: d.institution ?? null,
          minhashSignatureJson: JSON.stringify(minhash),
          shingleCount: typeof d.shingleCount === "number" ? d.shingleCount : 0,
          originalityPercent: typeof d.originalityPercent === "number" ? d.originalityPercent : null,
        },
      })
    }
  }
}

