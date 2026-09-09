import { vi } from "vitest"
import { prismaMock, resetPrismaMock } from "./mocks/prisma-mock"

process.env.SESSION_SECRET = "test-session-secret-min-16-chars"
process.env.REPORT_ACCESS_SECRET = "test-report-secret-16"
process.env.CLEANUP_CRON_SECRET = "test-cron-secret"
process.env.NODE_ENV = "test"
process.env.LDAP_ENABLED = "false"
process.env.REPORT_PUBLIC_BASE_URL = "https://antiplagiat.bsuir.by"
process.env.NEXT_PUBLIC_APP_URL = "https://antiplagiat.bsuir.by"

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}))

resetPrismaMock()
