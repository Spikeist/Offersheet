/**
 * What the Import Report and the League page show when this tab holds no import they can read (CLAUDE.md
 * §14): "No league imported yet", or, when the import was saved by an earlier version of Offer Sheet
 * (importStore.ts readStoredImport: "outdated"), that Offer Sheet was updated and the league needs
 * importing again, rather than suggesting the import was lost. Either way, a link to the Connect page.
 */
import Link from "next/link";
import { OUTDATED_IMPORT_TEXT, OUTDATED_IMPORT_TITLE } from "@/lib/importStore";
import { Card, buttonClass } from "./ui";

export const NO_IMPORT_TITLE = "No league imported yet";

/** `text`: the page's own words for a tab with no import at all. */
export function NoImportCard({ outdated, text }: { outdated: boolean; text: string }) {
  return (
    <Card className="mx-auto max-w-xl text-center">
      <h1 className="text-2xl font-black tracking-tight">{outdated ? OUTDATED_IMPORT_TITLE : NO_IMPORT_TITLE}</h1>
      <p className="mt-2 text-muted">{outdated ? OUTDATED_IMPORT_TEXT : text}</p>
      <Link href="/connect" className={`${buttonClass("primary")} mt-5`}>
        Connect your league
      </Link>
    </Card>
  );
}
