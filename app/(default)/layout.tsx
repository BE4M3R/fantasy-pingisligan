import { DocumentLayout } from "@/app/document-layout";
import { PageRefresh } from "@/app/page-refresh";

export { metadata } from "@/app/document-layout";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <DocumentLayout language="sv"><PageRefresh>{children}</PageRefresh></DocumentLayout>;
}
