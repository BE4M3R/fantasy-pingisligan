import { DashboardBottomNavigation } from "@/app/dashboard/bottom-navigation";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {children}
      <DashboardBottomNavigation />
    </>
  );
}
