import Link from "next/link"
import Image from "next/image"

export function BsuirLogo({ className = "", href }: { className?: string; href?: string }) {
  const content = (
    <div className={`flex items-center gap-2 ${className}`}>
      <Image
        src="/bsuir-logo.png"
        alt="БГУИР"
        width={120}
        height={32}
        className="h-8 w-auto object-contain"
        priority
      />
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="hover:opacity-80 transition-opacity cursor-pointer">
        {content}
      </Link>
    )
  }

  return content
}
