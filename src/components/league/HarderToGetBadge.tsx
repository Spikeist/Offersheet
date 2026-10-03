/**
 * "Harder to get" (planner addendum to Checkpoint 3, §2): a gold pill in words (never color alone), why on hover. The
 * League page's rosters and partner cards use it for other teams' players his manager values above market, and the
 * trade cards for the players I'd get (src/lib/leagueView.ts, src/lib/tradeView.ts write the words).
 *
 * `describe`: screen readers hear the why too, the whole hover text ("Harder to get: their most valuable player and …")
 * in place of the pill's two words (a title isn't reliably read, and a touch screen can't hover). The trade cards use it
 * (review of the addendum: the why lived only in the title there); the League page doesn't, where the pill sits inside a
 * roster button whose name it joins, and its explainer says what the tag means.
 */
import { Badge } from "../ui";

export function HarderToGetBadge({ tag, className, describe = false }: { tag: { text: string; title: string }; className?: string; describe?: boolean }) {
  return (
    <span title={tag.title} className={className}>
      <Badge tone="accent" className="align-middle">
        {describe ? <span aria-hidden>{tag.text}</span> : tag.text}
      </Badge>
      {describe ? <span className="sr-only">{tag.title}</span> : null}
    </span>
  );
}
