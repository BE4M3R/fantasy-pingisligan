"use client";

import { useState } from "react";

export function CompetitionSponsorLogo({ src, alt, eager = false }: {
  src: string; alt: string; eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <span className="sponsored-logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={alt} src={src} loading={eager ? "eager" : "lazy"} onError={() => setFailed(true)} ref={(image) => {
        // An eager server-rendered image can fail before hydration attaches onError.
        if (image?.complete && image.naturalWidth === 0) setFailed(true);
      }} className="max-h-8 w-auto max-w-full object-contain" />
    </span>
  );
}
