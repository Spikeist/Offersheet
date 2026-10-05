import { CONTACT_EMAIL } from "@/lib/site";

/**
 * "Contact: offersheet.app@gmail.com" on the privacy policy, the terms and the feedback page (planner reply to Checkpoint
 * 7a, 3: Offer Sheet's own address, src/lib/site.ts CONTACT_EMAIL). A link inside a short sentence, so check:browser's
 * 44 px rule counts it as inline (WCAG 2.5.8's exception).
 */
export function ContactLine({ className }: { className?: string }) {
  return (
    <p className={className}>
      Contact:{" "}
      <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold underline underline-offset-2">
        {CONTACT_EMAIL}
      </a>
    </p>
  );
}
