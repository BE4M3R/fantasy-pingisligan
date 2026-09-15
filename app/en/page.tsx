import { Homepage } from "@/app/homepage";
import { homePageMetadata } from "@/lib/seo";

export const metadata = homePageMetadata("en");

export default function EnglishHome() {
  return <Homepage language="en" />;
}
