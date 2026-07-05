import QRCode from "qrcode"

export async function qrPngDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { width: 200, margin: 1, type: "image/png" })
}
