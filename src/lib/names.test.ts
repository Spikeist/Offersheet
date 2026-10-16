/**
 * Players' names in short (src/lib/names.ts): surname for a release's reason (Checkpoint 7f; planner reply to Checkpoint 7e,
 * answer 4; since Checkpoint 7g the planner's reply to Checkpoint 7f, answer 5: "From week 7 on, he and Marvin Harrison Jr. add
 * about the same to your starting lineup, and Harrison Jr. has more trade value. Lock Pierce to keep him instead."), and
 * shortName as the League page had it (leagueView.test.ts holds its cases too, through the re-export).
 */
import { describe, expect, it } from "vitest";
import { shortName as leagueShortName } from "./leagueView";
import { shortName, surname } from "./names";

describe("surname: the last name as a sentence says it", () => {
  it("keeps the suffix and the particles, drops first and middle names (the planner's own Harrison Jr.)", () => {
    expect(surname("Alec Pierce")).toBe("Pierce");
    expect(surname("Marvin Harrison Jr.")).toBe("Harrison Jr.");
    expect(surname("Kyle Pitts Sr.")).toBe("Pitts Sr.");
    expect(surname("Kenneth Walker III")).toBe("Walker III");
    expect(surname("Amon-Ra St. Brown")).toBe("St. Brown");
    expect(surname("Kyle Van Noy")).toBe("Van Noy");
    expect(surname("Van Jefferson")).toBe("Jefferson");
    expect(surname("Jacory Croskey-Merritt")).toBe("Croskey-Merritt");
    expect(surname("Bartholomew Maximilian Worthington-Fitzgerald III")).toBe("Worthington-Fitzgerald III");
    expect(surname("  Romeo   Doubs ")).toBe("Doubs");
  });

  it("a one-word name and a team defense stay as they are", () => {
    expect(surname("Cher")).toBe("Cher");
    expect(surname("Giants D/ST", "DEF")).toBe("Giants D/ST");
    expect(surname("Vikings D/ST", "DEF")).toBe("Vikings D/ST");
  });
});

describe("shortName: moved from leagueView.ts unchanged", () => {
  it("first initial and last name, suffixes and middle names dropped, particles kept; the League page's export is the same function", () => {
    expect(shortName("Justin Jefferson")).toBe("J. Jefferson");
    expect(shortName("Travis Etienne Jr.")).toBe("T. Etienne");
    expect(shortName("Amon-Ra St. Brown")).toBe("A. St. Brown");
    expect(shortName("Vikings D/ST", "DEF")).toBe("Vikings D/ST");
    expect(leagueShortName).toBe(shortName);
  });
});
