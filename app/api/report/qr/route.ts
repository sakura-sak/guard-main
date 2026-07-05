import { type NextRequest, NextResponse } from "next/server"
import QRCode from "qrcode"

/**
 * GET /api/report/qr?data=<url>
 * PNG QR-код для браузерной справки (без внешнего api.qrserver.com).
 */
export async function GET(request: NextRequest) {
  try {
    const data = request.nextUrl.searchParams.get("data")?.trim()
    if (!data) {
      return NextResponse.json({ success: false, error: "Missing data" }, { status: 400 })
    }
    const png = await QRCode.toBuffer(data, { width: 200, margin: 1, type: "png" })
    return new NextResponse(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (error) {
    console.error("QR image error:", error)
    return NextResponse.json({ success: false, error: "Failed to generate QR" }, { status: 500 })
  }
}
