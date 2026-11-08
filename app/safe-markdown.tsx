import Link from "next/link";
import Markdown from "react-markdown";
import { safeAnnouncementUrl } from "@/lib/announcements";

export function SafeMarkdown({ children, onFollowLink }: { children: string; onFollowLink?: (url: string) => void }) {
  return <div className="space-y-3 break-words text-sm leading-6 text-[var(--pf-text)] [&_li]:ml-5 [&_ol]:list-decimal [&_strong]:font-bold [&_ul]:list-disc">
    <Markdown skipHtml allowedElements={["p", "strong", "em", "ul", "ol", "li", "a", "br"]} unwrapDisallowed
      urlTransform={(url) => safeAnnouncementUrl(url) ?? ""}
      components={{ a: ({ href, children }) => {
        const safe = safeAnnouncementUrl(href);
        return safe ? <Link className="font-semibold text-[var(--pf-brand-blue-hover)] underline underline-offset-2" href={safe}
          onClick={onFollowLink ? (event) => {
            if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              event.preventDefault(); onFollowLink(safe);
            }
          } : undefined}>{children}</Link> : <span>{children}</span>;
      } }}>{children}</Markdown>
  </div>;
}
