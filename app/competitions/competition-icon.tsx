export function CompetitionIcon({ className, season = false }: { className: string; season?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={season ? "m3 6 5 4 4-6 4 6 5-4-2 12H5L3 6Zm3 15h12" : "M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 13v5m-4 3h8m-6-3h4l1 3H9l1-3Z"} />
    </svg>
  );
}

export function CompetitionChevron({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`text-[var(--pf-logo-gold)] ${className}`}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
