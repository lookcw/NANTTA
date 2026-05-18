import type { Complex, DisplayResponse } from "./types";

/** Fetch the per-complex catalog used by the Setup page. */
export async function fetchStations(): Promise<Complex[]> {
  const res = await fetch("/api/stations");
  if (!res.ok) throw new Error(`/api/stations: ${res.status}`);
  const body = (await res.json()) as { complexes: Complex[] };
  return body.complexes;
}

/** Initial card payload for /display. Pass the query string built from the
 *  current subscriptions (same shape the legacy URL params used). */
export async function fetchDisplay(search: string): Promise<DisplayResponse> {
  const url = "/api/display" + (search ? (search.startsWith("?") ? search : `?${search}`) : "");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`/api/display: ${res.status}`);
  return (await res.json()) as DisplayResponse;
}

/** Open the live SSE stream for /display. Returns the EventSource so the
 *  caller can close it on unmount. */
export function openDisplayStream(search: string): EventSource {
  const url = "/api/display/stream" + (search ? (search.startsWith("?") ? search : `?${search}`) : "");
  return new EventSource(url);
}
