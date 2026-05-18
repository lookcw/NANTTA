// Domain types shared by Setup and Display.
//
// Backend payload shapes mirror what the API endpoints emit; the TS types
// here are the contract. If the backend evolves, update both ends together.

export type Direction = "N" | "S" | "*";

export type FontSize = "s" | "m" | "l";

/** Per-line setting inside a {@link Subscription}. */
export interface LineSpec {
  line: string;
  dir: Direction;
  showDest: boolean;
}

/** One station complex worth of subscription state. */
export interface Subscription {
  cx: string;
  mins: number;
  lines: LineSpec[];
}

/** Top-level user config. */
export interface UserConfig {
  subs: Subscription[];
  n: number;
  fontSize: FontSize;
}

/** Per-line direction labels returned by /api/stations. */
export interface LineInfo {
  line: string;
  n_label: string | null;
  s_label: string | null;
  n_short: string;
  s_short: string;
}

/** Catalog row served by /api/stations. */
export interface Complex {
  id: string;
  name: string;
  borough: string;
  lines: string[];
  line_info: LineInfo[];
  stop_ids: string[];
  haystack: string;
}

/** One train row inside a {@link CardPayload}. */
export interface TrainRow {
  route: string;
  route_color: string;
  route_text_color: string;
  is_express: boolean;
  direction: string;
  terminus_name: string;
  direction_borough_short: string;
  arrival_epoch: number;
  seconds_until: number;
  display: string;
  show_dest: boolean;
}

/** One card returned by /api/display and /api/display/stream. */
export interface CardPayload {
  card_id: string;
  complex_id: string;
  complex: { id: string; name: string; borough: string; lines: string[] } | null;
  any_show_dest: boolean;
  rows: TrainRow[];
}

/** Full /api/display response. */
export interface DisplayResponse {
  server_now: number;
  feed_age_seconds: number | null;
  trains_per_card: number;
  font_size: FontSize;
  subs: CardPayload[];
}

/** Per-tick SSE payload. */
export interface DisplayStreamMessage {
  server_now: number;
  feed_age_seconds: number | null;
  subs: CardPayload[];
}
