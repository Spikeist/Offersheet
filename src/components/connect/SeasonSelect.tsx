import { OLDEST_SEASON } from "@/lib/season";
import { inputClass } from "../ui";

/** Season picker: the newest importable season first (lib/season newestSeason), back to the oldest one the adapters serve. */
export function SeasonSelect({
  id,
  value,
  newest,
  onChange,
  disabled,
  describedBy,
}: {
  id: string;
  value: number;
  newest: number;
  onChange: (season: number) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  const seasons: number[] = [];
  for (let s = newest; s >= OLDEST_SEASON; s--) seasons.push(s);
  if (!seasons.includes(value)) seasons.unshift(value);
  return (
    <select id={id} value={value} disabled={disabled} aria-describedby={describedBy} onChange={(e) => onChange(Number(e.target.value))} className={inputClass}>
      {seasons.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
