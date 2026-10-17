"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlayerStatistics } from "@/lib/player-statistics-data";

// Sports data only; bounded reuse across picker instances and repeated opens.
const cache = new Map<string, { data: PlayerStatistics; expiresAt: number }>();
const requests = new Map<string, Promise<PlayerStatistics>>();
async function loadStatistics(id: string) {
  const cached = cache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const pending = requests.get(id);
  if (pending) return pending;
  const request = (async () => {
    const response = await fetch(`/api/players/${id}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Could not load player statistics.");
    if (cache.size >= 20) cache.delete(cache.keys().next().value!);
    cache.set(id, { data: payload as PlayerStatistics, expiresAt: Date.now() + 60_000 });
    return payload as PlayerStatistics;
  })().finally(() => requests.delete(id));
  requests.set(id, request);
  return request;
}

export function usePlayerStatistics(playerId: string, enabled: boolean) {
  const [statistics, setStatistics] = useState<PlayerStatistics | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try { setStatistics(await loadStatistics(playerId)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load player statistics."); }
  }, [playerId]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void loadStatistics(playerId).then((data) => {
      if (active) { setStatistics(data); setError(""); }
    }, (failure) => {
      if (active) setError(failure instanceof Error ? failure.message : "Could not load player statistics.");
    });
    return () => { active = false; };
  }, [playerId, enabled]);

  return { statistics, error, load };
}
