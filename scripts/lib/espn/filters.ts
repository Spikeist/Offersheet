/**
 * X-Fantasy-Filter payloads copied from cwendt94/espn-api (MIT License, Copyright (c) 2018 Christian
 * Wendt). CLAUDE.md §2.2 says: copy working payloads, don't invent them. Each builder names the
 * espn-api function it mirrors; `FILTER_SOURCE_MARKERS` lets the probe check that the upstream
 * source still contains them (drift check against the commit we fetched).
 */

/** football/league.py League.free_agents(week, size, position): view=kona_player_info&scoringPeriodId=week. */
export function freeAgentFilter(size: number, slotIds: number[] = []) {
  return {
    players: {
      filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
      filterSlotIds: { value: slotIds },
      limit: size,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "STANDARD" },
    },
  };
}

/**
 * requests/espn_requests.py get_player_card(playerIds, max_scoring_period), used by
 * League.player_info(): view=kona_playercard. additionalValue "00{year}" / "10{year}" ask for the
 * season's actual (source 0) and projected (source 1) stat lines.
 */
export function playerCardFilter(playerIds: number[], maxScoringPeriod: number, season: number) {
  return {
    players: {
      filterIds: { value: playerIds },
      filterStatsForTopScoringPeriodIds: { value: maxScoringPeriod, additionalValue: [`00${season}`, `10${season}`] },
    },
  };
}

/** espn_requests.py get_player_pool_ids(): rostered + free agents + waivers, paged. view=kona_player_info. */
export function playerPoolFilter(limit: number, offset: number) {
  return {
    players: {
      filterStatus: { value: ["FREEAGENT", "WAIVERS", "ONTEAM"] },
      limit,
      offset,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  };
}

/** football/league.py League.transactions(scoring_period, types): view=mTransactions2&scoringPeriodId=N. */
export function transactionsFilter(types: string[]) {
  return { transactions: { filterType: { value: types } } };
}

/** espn-api's recent_activity() default message types: FA add, waiver add, drops, trades. */
export const RECENT_ACTIVITY_MESSAGE_TYPES = [178, 180, 179, 239, 181, 244];

/** football/league.py League.recent_activity(size, msg_type, offset): GET <league>/communication/?view=kona_league_communication. */
export function recentActivityFilter(size: number, offset: number, messageTypes: number[] = RECENT_ACTIVITY_MESSAGE_TYPES) {
  return {
    topics: {
      filterType: { value: ["ACTIVITY_TRANSACTIONS"] },
      limit: size,
      limitPerMessageSet: { value: 25 },
      offset,
      sortMessageDate: { sortPriority: 1, sortAsc: false },
      sortFor: { sortPriority: 2, sortAsc: false },
      filterIncludeMessageTypeIds: { value: messageTypes },
    },
  };
}

/** requests/espn_requests.py get_pro_players(): GET /seasons/{year}/players?view=players_wl. */
export function proPlayersFilter() {
  return { filterActive: { value: true } };
}

/** The header name espn-api sends (HTTP header names are case-insensitive). */
export const FILTER_HEADER = "x-fantasy-filter";

export function filterHeaders(filter: unknown): Record<string, string> {
  return { [FILTER_HEADER]: JSON.stringify(filter) };
}

/** Snippets that must still appear in the upstream files for our copies to be current. */
export const FILTER_SOURCE_MARKERS: Record<string, string[]> = {
  "espn_api/football/league.py": [
    '"filterStatus": {"value": ["FREEAGENT", "WAIVERS"]}',
    '"filterSlotIds": {"value": slot_filter}',
    '"sortPercOwned": {"sortPriority": 1, "sortAsc": False}',
    '"sortDraftRanks": {',
    '"value": "STANDARD"',
    'filters = {"transactions": {"filterType": {"value": list(types)}}}',
    '"filterType": {"value": ["ACTIVITY_TRANSACTIONS"]}',
    '"limitPerMessageSet": {"value": 25}',
    'msg_types = [178, 180, 179, 239, 181, 244]',
    '"view": "kona_league_communication"',
  ],
  "espn_api/requests/espn_requests.py": [
    '"filterIds": {"value": playerIds}',
    '"filterStatsForTopScoringPeriodIds": {',
    'additional_value = ["00{}".format(self.year), "10{}".format(self.year)]',
    '"filterStatus": {"value": ["FREEAGENT", "WAIVERS", "ONTEAM"]}',
    'filters = {"filterActive": {"value": True}}',
    'params = {"view": "players_wl"}',
  ],
};

/** Collapse whitespace so reformatting upstream (black line wraps) doesn't break the drift check. */
export function sourceHasMarker(source: string, marker: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, "");
  return squash(source).includes(squash(marker));
}
