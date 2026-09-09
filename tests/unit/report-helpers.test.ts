import { describe, expect, it } from "vitest"
import { buildReportQrLinks, resolvePublicBaseUrl } from "@/lib/report-qr-links"
import { decodePathSegmentSig, getQrSignature, reportVerifyResponse } from "@/lib/report-verify-get"
import { qrPngDataUrl } from "@/lib/report-qr-images"
import { signDocumentAccess } from "@/lib/report-access"
import { prismaMock, sampleDocumentRow } from "../mocks/prisma-mock"
import { NextRequest } from "next/server"

describe("report helpers", () => {
  it("prefers REPORT_PUBLIC_BASE_URL and builds QR links", () => {
    const req = new NextRequest("https://antiplagiat.bsuir.by/app.html", {
      headers: { host: "antiplagiat.bsuir.by", "x-forwarded-proto": "https" },
    })
    expect(resolvePublicBaseUrl(req)).toBe("https://antiplagiat.bsuir.by")
    const links = buildReportQrLinks(42, "https://antiplagiat.bsuir.by/")
    expect(links.verifyUrl).toContain("documentId=42")
    expect(links.originalUrl).toContain("/original")
  })

  it("falls back to forwarded host and loopback", () => {
    const prevPublic = process.env.REPORT_PUBLIC_BASE_URL
    const prevNext = process.env.NEXT_PUBLIC_APP_URL
    delete process.env.REPORT_PUBLIC_BASE_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    const prod = new NextRequest("http://x/", {
      headers: { host: "antiplagiat.bsuir.by:443", "x-forwarded-proto": "https" },
    })
    expect(resolvePublicBaseUrl(prod)).toBe("https://antiplagiat.bsuir.by")
    const local = new NextRequest("http://x/", { headers: { host: "localhost:3000" } })
    expect(resolvePublicBaseUrl(local)).toContain("localhost")
    if (prevPublic) process.env.REPORT_PUBLIC_BASE_URL = prevPublic
    if (prevNext) process.env.NEXT_PUBLIC_APP_URL = prevNext
  })

  it("reads sig from query including broken amp;sig", () => {
    expect(getQrSignature(new URLSearchParams("sig=abc"))).toBe("abc")
    expect(getQrSignature(new URLSearchParams("amp;sig=xyz"))).toBe("xyz")
    expect(decodePathSegmentSig("a%2Fb")).toBe("a/b")
  })

  it("verifies a signed report request", async () => {
    prismaMock.document.findUnique.mockResolvedValue(sampleDocumentRow)
    const sig = signDocumentAccess("report", 42)
    const ok = await reportVerifyResponse(42, sig, true)
    expect(ok.status).toBe(200)
    const forbidden = await reportVerifyResponse(42, "bad", true)
    expect(forbidden.status).toBe(403)
    const badId = await reportVerifyResponse(Number.NaN, sig, true)
    expect(badId.status).toBe(400)
  })

  it("renders a png data url for QR", async () => {
    const url = await qrPngDataUrl("https://antiplagiat.bsuir.by")
    expect(url.startsWith("data:image/png")).toBe(true)
  })
})
