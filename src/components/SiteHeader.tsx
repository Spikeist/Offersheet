import Link from "next/link";

export function LogoMark({ className }: { className?: string }) {
  // A football on a gold tile.
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <ellipse cx="16" cy="16" rx="11" ry="7" transform="rotate(-35 16 16)" fill="var(--navy)" />
      <path d="M12.5 19.5l7-7" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14 15.4l1.6 1.6M15.7 13.7l1.6 1.6M17.4 12l1.6 1.6" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="bg-navy text-navy-contrast">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-extrabold tracking-tight">
          <LogoMark className="size-8" />
          <span className="text-lg">Offer Sheet</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm font-bold">
          <Link href="/connect" className="rounded-lg px-2.5 py-2 hover:bg-white/10">
            Connect
          </Link>
          <Link href="/import" className="rounded-lg px-2.5 py-2 hover:bg-white/10">
            Import report
          </Link>
        </nav>
      </div>
    </header>
  );
}
