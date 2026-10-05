import { CONTACT_EMAIL, CONTACT_PENDING } from "@/lib/site";

/**
 * "Contact: …" on the privacy policy, the terms and the feedback page (planner reply to Checkpoint 4c, B3). One constant
 * holds the address (src/lib/site.ts CONTACT_EMAIL); until Parker picks one the line says so, marked so nobody takes it
 * for an address ("Contact: to be added before launch"). The Checkpoint 7b go/no-go list carries it.
 */
export function ContactLine({ className }: { className?: string }) {
  return (
    <p className={className}>
      Contact:{" "}
      {CONTACT_EMAIL ? (
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold underline underline-offset-2">
          {CONTACT_EMAIL}
        </a>
      ) : (
        <span className="rounded bg-warn-bg px-1.5 py-0.5 font-semibold text-warn-fg">{CONTACT_PENDING}</span>
      )}
    </p>
  );
}
