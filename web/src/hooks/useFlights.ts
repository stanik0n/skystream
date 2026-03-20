import { useCallback, useEffect, useRef, useState } from 'react';
import type { Aircraft, FlightPhase, PositionsMessage, TrailEntry } from '../types';

const RECONNECT_DELAY_MS = 3000;
const MAX_TRAIL_POINTS = 20;
const STALE_TIMEOUT_MS = 15_000;
// Don't interpolate beyond this many seconds (plane may have turned)
const MAX_INTERP_SECONDS = 15;

interface UseFlightsResult {
  aircraft: Aircraft[];
  trails: TrailEntry[];
  connected: boolean;
  count: number;
  lastUpdate: Date | null;
}

/** Dead-reckon a single aircraft forward by `elapsed` seconds */
function interpolateAircraft(ac: Aircraft, elapsed: number): Aircraft {
  if (
    ac.on_ground ||
    ac.velocity == null ||
    ac.heading == null ||
    ac.velocity < 10 // effectively stationary
  ) {
    return ac;
  }
  const headingRad = (ac.heading * Math.PI) / 180;
  const dlat = (ac.velocity * Math.cos(headingRad) * elapsed) / 111_320;
  const dlon =
    (ac.velocity * Math.sin(headingRad) * elapsed) /
    (111_320 * Math.cos((ac.lat * Math.PI) / 180));
  return { ...ac, lat: ac.lat + dlat, lon: ac.lon + dlon };
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
  // Anchor: last real positions received from WebSocket + when we got them
  const anchorRef = useRef<{ aircraft: Aircraft[]; timestamp: number } | null>(null);

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

  // Interpolation ticker — runs every second, projects positions forward from last anchor
  useEffect(() => {
    const id = setInterval(() => {
      if (!anchorRef.current || !mountedRef.current) return;
      const { aircraft: anchored, timestamp } = anchorRef.current;
      const elapsed = (Date.now() - timestamp) / 1000;
      if (elapsed > MAX_INTERP_SECONDS) return;

      setAircraftMap(() => {
        const next = new Map<string, Aircraft>();
        for (const ac of anchored) {
          next.set(ac.icao24, interpolateAircraft(ac, elapsed));
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(id);
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

          // Update anchor — interpolation ticker will pick this up next tick
          anchorRef.current = { aircraft: valid, timestamp: Date.now() };

          // Immediately render real positions
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
