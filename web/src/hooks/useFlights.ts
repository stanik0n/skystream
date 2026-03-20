import { useCallback, useEffect, useRef, useState } from 'react';
import type { Aircraft, FlightPhase, PositionsMessage, TrailEntry } from '../types';

const RECONNECT_DELAY_MS = 3000;
const MAX_TRAIL_POINTS = 20;
const STALE_TIMEOUT_MS = 15_000;

interface UseFlightsResult {
  aircraft: Aircraft[];
  trails: TrailEntry[];
  connected: boolean;
  count: number;
  lastUpdate: Date | null;
}

export function useFlights(wsUrl: string): UseFlightsResult {
  const [aircraftMap, setAircraftMap] = useState<Map<string, Aircraft>>(new Map());
  const [trailsMap, setTrailsMap] = useState<
    Map<string, { path: [number, number][]; phase: FlightPhase }>
  >(new Map());
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Fetch historical trails from the server on mount
  useEffect(() => {
    const httpUrl = wsUrl.replace(/^ws/, 'http').replace(/\/ws$/, '');
    fetch(`${httpUrl}/trails`)
      .then((r) => r.json())
      .then((data: { trails: Array<{ icao24: string; path: [number, number][]; phase: FlightPhase }> }) => {
        if (!mountedRef.current) return;
        setTrailsMap((prev) => {
          const next = new Map(prev);
          for (const trail of data.trails) {
            if (trail.path.length > 1) {
              next.set(trail.icao24, { path: trail.path, phase: trail.phase });
            }
          }
          return next;
        });
      })
      .catch((err) => console.warn('[SkyStream] Failed to fetch trails:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const resetStaleTimer = () => {
        if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
        staleTimerRef.current = setTimeout(() => {
          if (!mountedRef.current) return;
          console.warn('[SkyStream] No message received in 15s — reconnecting.');
          ws.onclose = null;
          ws.close();
          wsRef.current = null;
          setConnected(false);
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }, STALE_TIMEOUT_MS);
      };

      ws.onopen = () => {
        if (!mountedRef.current) return;
        console.info('[SkyStream] WebSocket connected to', wsUrl);
        setConnected(true);
        resetStaleTimer();
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        if (!mountedRef.current) return;
        resetStaleTimer();
        try {
          const msg: PositionsMessage = JSON.parse(event.data);
          if (msg.type !== 'positions') return;

          const valid = msg.aircraft.filter((ac) => ac.lat != null && ac.lon != null);

          setAircraftMap(() => {
            const next = new Map<string, Aircraft>();
            for (const ac of valid) next.set(ac.icao24, ac);
            return next;
          });

          setTrailsMap((prev) => {
            const next = new Map(prev);
            for (const ac of valid) {
              const existing = next.get(ac.icao24) ?? { path: [], phase: ac.flight_phase };
              const newPath: [number, number][] = [...existing.path, [ac.lon, ac.lat]];
              if (newPath.length > MAX_TRAIL_POINTS) newPath.shift();
              next.set(ac.icao24, { path: newPath, phase: ac.flight_phase });
            }
            return next;
          });

          setLastUpdate(new Date(msg.timestamp));
        } catch (err) {
          console.error('[SkyStream] Failed to parse message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('[SkyStream] WebSocket error:', err);
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        console.warn(
          '[SkyStream] WebSocket closed (code=%d, reason=%s). Reconnecting in %dms…',
          event.code,
          event.reason,
          RECONNECT_DELAY_MS,
        );
        setConnected(false);
        wsRef.current = null;
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    } catch (err) {
      console.error('[SkyStream] Failed to create WebSocket:', err);
      reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
    }
  }, [wsUrl]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  const aircraft = Array.from(aircraftMap.values());
  const trails: TrailEntry[] = Array.from(trailsMap.entries()).map(
    ([icao24, { path, phase }]) => ({ icao24, path, phase }),
  );

  return {
    aircraft,
    trails,
    connected,
    count: aircraft.length,
    lastUpdate,
  };
}
