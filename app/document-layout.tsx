import type { Metadata } from "next";
import { HOME_DESCRIPTION, SITE_NAME } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = {
  title: SITE_NAME,
  description: HOME_DESCRIPTION,
  // Only public pages opt into indexing via publicPageMetadata.
  robots: { index: false, follow: false },
};

export function DocumentLayout({
  children,
  language,
}: Readonly<{
  children: React.ReactNode;
  language: "sv" | "en";
}>) {
  return (
    <html lang={language} className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
