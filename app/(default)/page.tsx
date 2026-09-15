import { Homepage } from "@/app/homepage";
import { homePageMetadata } from "@/lib/seo";

export const metadata = homePageMetadata("sv");

export default function Home() {
  return <Homepage language="sv" />;
}
