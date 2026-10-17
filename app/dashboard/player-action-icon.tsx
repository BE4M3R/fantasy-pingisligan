type PlayerActionIconProps = {
  kind: "captain" | "transfer" | "swap" | "arrow" | "remove";
  className?: string;
};

export function PlayerActionIcon({ kind, className = "h-4 w-4 shrink-0" }: PlayerActionIconProps) {
  const paths = {
    captain: "m3 6 4 4 5-7 5 7 4-4-2 12H5L3 6Zm3 15h12",
    transfer: "M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4",
    swap: "M7 3v18m-4-4 4 4 4-4M17 21V3m-4 4 4-4 4 4",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    remove: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6",
  };

  return <svg aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
    <path d={paths[kind]} />
  </svg>;
}
