import type { Metadata } from "next";
import { HOME_DESCRIPTION, SITE_NAME, socialMetadata } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = {
  ...socialMetadata(),
  title: SITE_NAME,
  description: HOME_DESCRIPTION,
  // Both language roots share these explicit links, including private pages.
  icons: {
    icon: [
      {
        url: "/favicon.ico",
        sizes: "16x16 32x32 48x48 64x64 96x96 128x128 256x256",
        type: "image/x-icon",
      },
      { url: "/branding/icon-96.png", sizes: "96x96", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: { url: "/branding/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
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
