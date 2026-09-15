import { DocumentLayout } from "@/app/document-layout";

export { metadata } from "@/app/document-layout";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <DocumentLayout language="en">{children}</DocumentLayout>;
}
