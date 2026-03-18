import { useCallback, useEffect, useRef, useState } from 'react';
import type { Aircraft, PositionsMessage } from '../types';

const RECONNECT_DELAY_MS = 3000;

interface UseFlightsResult {
  aircraft: Aircraft[];
  connected: boolean;
  count: number;
  lastUpdate: Date | null;
}

export function useFlights(wsUrl: string): UseFlightsResult {
  const [aircraftMap, setAircraftMap] = useState<Map<string, Aircraft>>(new Map());
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        console.info('[SkyStream] WebSocket connected to', wsUrl);
        setConnected(true);
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        if (!mountedRef.current) return;
        try {
          const msg: PositionsMessage = JSON.parse(event.data);
          if (msg.type !== 'positions') return;

          setAircraftMap((prev) => {
            const next = new Map(prev);
            for (const ac of msg.aircraft) {
              // Only update if lat/lon are valid numbers
              if (ac.lat != null && ac.lon != null) {
                next.set(ac.icao24, ac);
              }
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
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
      }
    };
  }, [connect]);

  const aircraft = Array.from(aircraftMap.values());

  return {
    aircraft,
    connected,
    count: aircraft.length,
    lastUpdate,
  };
}
