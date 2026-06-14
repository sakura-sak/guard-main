import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"

const _geist = Geist({ subsets: ["latin"] })
const _geistMono = Geist_Mono({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "BSUIR Антиплагиат - Система проверки уникальности",
  description:
    "Система антиплагиата БГУИР. Проверка уникальности студенческих работ с использованием алгоритмов MinHash, LSH и Jaccard Similarity",
  keywords: "BSUIR, БГУИР, антиплагиат, проверка уникальности, студенческие работы",
  openGraph: {
    title: "BSUIR Антиплагиат",
    description: "Система проверки уникальности студенческих работ БГУИР",
    url: "https://bsuir.by",
    siteName: "BSUIR Антиплагиат",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
