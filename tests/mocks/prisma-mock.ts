import { vi } from "vitest"

export function createModel() {
  return {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(async ({ data }: { data?: Record<string, unknown> }) => ({
      id: 1,
      isActive: true,
      faculties: [],
      createdAt: new Date(),
      ...data,
    })),
    update: vi.fn().mockImplementation(async ({ data }: { data?: Record<string, unknown> }) => ({
      id: 1,
      isActive: true,
      ...data,
    })),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    delete: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn().mockResolvedValue(0),
    upsert: vi.fn().mockResolvedValue({}),
    aggregate: vi.fn().mockResolvedValue({
      _avg: { originalityPercent: 80, processingTimeMs: 1000 },
      _count: { _all: 0 },
      _max: {},
      _min: {},
      _sum: {},
    }),
    groupBy: vi.fn().mockResolvedValue([]),
  }
}

export const prismaMock = {
  user: createModel(),
  document: createModel(),
  institution: createModel(),
  faculty: createModel(),
  documentType: createModel(),
  analysisJob: createModel(),
  report: createModel(),
  auditLog: createModel(),
  plagiarismMatch: createModel(),
  documentContent: createModel(),
  documentSignature: createModel(),
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: typeof prismaMock) => unknown)(prismaMock)
    if (Array.isArray(arg)) return Promise.all(arg)
    return arg
  }),
}

export function resetPrismaMock() {
  for (const key of Object.keys(prismaMock) as Array<keyof typeof prismaMock>) {
    const model = prismaMock[key]
    if (model && typeof model === "object") {
      for (const fn of Object.values(model)) {
        if (typeof fn === "function" && "mockClear" in fn) (fn as { mockClear: () => void }).mockClear()
      }
    }
  }
  prismaMock.institution.count.mockResolvedValue(1)
  prismaMock.documentType.count.mockResolvedValue(1)
  prismaMock.analysisJob.count.mockResolvedValue(0)
  prismaMock.document.count.mockResolvedValue(0)
  prismaMock.user.count.mockResolvedValue(0)
  prismaMock.institution.findMany.mockResolvedValue([])
  prismaMock.document.findMany.mockResolvedValue([])
  prismaMock.user.findMany.mockResolvedValue([])
  prismaMock.documentType.findMany.mockResolvedValue([])
  prismaMock.analysisJob.findMany.mockResolvedValue([])
  prismaMock.plagiarismMatch.findMany.mockResolvedValue([])
}

export const sampleUserRow = {
  username: "7123456",
  password: "LDAP_AUTH_ONLY_USER_MARKER",
  role: "student",
  additionalRolesJson: null,
  email: "s@bsuir.by",
  fullName: "Иванов Иван",
  groupName: "050501",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  lastLogin: new Date("2026-01-02T00:00:00.000Z"),
  institutionId: "bsuir",
  facultyId: "fksis",
  institution: { name: "БГУИР" },
  faculty: { name: "ФКСиС" },
}

export const sampleDocumentRow = {
  id: 42,
  title: "Лабораторная работа",
  filename: "lab.docx",
  fileFormat: "word",
  filePath: "data/lab/uploads/lab.docx",
  wordCount: 200,
  uploadDate: new Date("2026-01-01T10:00:00.000Z"),
  category: "lab",
  status: "draft",
  userId: "7123456",
  institutionId: "bsuir",
  facultyId: "fksis",
  documentTypeId: 1,
  originalityPercent: 81.7,
  plagiarismPercentMl: 18.3,
  localPlagiarismPercent: 12.5,
  aiPercentMl: 7.4,
  processingTimeMs: 12000,
  expiresAt: new Date("2026-01-02T10:00:00.000Z"),
  analysisCompletedAt: new Date("2026-01-01T10:20:00.000Z"),
  resultViewedAt: null,
  contentPayload: { text: "методы поиска похожих документов в корпусе университета ".repeat(5) },
  signaturePayload: { minhash: Array.from({ length: 128 }, (_, i) => i), shingleCount: 80 },
  institution: { name: "БГУИР" },
  faculty: { name: "ФКСиС" },
  user: {
    fullName: "Иванов Иван",
    institution: { name: "БГУИР" },
    faculty: { name: "ФКСиС" },
  },
  analysisJob: {
    id: 7,
    status: "completed",
    lastError: null,
    attempts: 1,
  },
}
