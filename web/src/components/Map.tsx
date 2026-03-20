import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { IconLayer, ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import { Map as MapLibreMap } from 'react-map-gl/maplibre';
import { FlyToInterpolator, LinearInterpolator } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { PickingInfo } from '@deck.gl/core';
import type { Aircraft, FlightPhase, TrailEntry } from '../types';
import { AIRPORTS, type Airport } from '../data/airports';

// ── Phase colours ─────────────────────────────────────────────────────────────
const PHASE_COLORS: Record<FlightPhase, [number, number, number, number]> = {
  GROUND:     [160, 160, 170, 220],
  CLIMBING:   [0,   220, 120, 245],
  CRUISE:     [50,  160, 255, 245],
  DESCENDING: [255, 170, 0,   245],
};

const PHASE_LABELS: Record<FlightPhase, string> = {
  GROUND:     'Ground',
  CLIMBING:   'Climbing',
  CRUISE:     'Cruise',
  DESCENDING: 'Descending',
};

// ── Per-type icon SVGs (each 100×100, mask:true so color is applied) ──────────
function makeSvgUrl(body: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${body}</svg>`
  )}`;
}

const ICONS = {
  plane: {
    url: makeSvgUrl('<path d="M50,5 C54,5 57,14 57,28 L57,48 L88,61 L88,68 L57,58 L57,73 L67,78 L67,85 L50,80 L33,85 L33,78 L43,73 L43,58 L12,68 L12,61 L43,48 L43,28 C43,14 46,5 50,5Z" fill="white"/>'),
    mapping: { icon: { x: 0, y: 0, width: 100, height: 100, mask: true } },
  },
  helicopter: {
    url: makeSvgUrl('<rect x="5" y="46" width="90" height="7" rx="3" fill="white"/><ellipse cx="50" cy="57" rx="14" ry="17" fill="white"/><rect x="47" y="57" width="6" height="28" rx="2" fill="white"/><rect x="33" y="81" width="28" height="5" rx="2" fill="white"/>'),
    mapping: { icon: { x: 0, y: 0, width: 100, height: 100, mask: true } },
  },
  balloon: {
    url: makeSvgUrl('<ellipse cx="50" cy="42" rx="27" ry="34" fill="white"/><rect x="42" y="76" width="16" height="12" rx="2" fill="white"/><line x1="44" y1="76" x2="36" y2="70" stroke="white" stroke-width="2"/><line x1="56" y1="76" x2="64" y2="70" stroke="white" stroke-width="2"/>'),
    mapping: { icon: { x: 0, y: 0, width: 100, height: 100, mask: true } },
  },
  glider: {
    url: makeSvgUrl('<path d="M50,12 C51,12 52,16 52,28 L52,44 L92,56 L92,62 L52,52 L52,60 L56,63 L56,68 L50,66 L44,68 L44,63 L48,60 L48,52 L8,62 L8,56 L48,44 L48,28 C48,16 49,12 50,12Z" fill="white"/>'),
    mapping: { icon: { x: 0, y: 0, width: 100, height: 100, mask: true } },
  },
  drone: {
    url: makeSvgUrl('<rect x="22" y="47" width="56" height="6" rx="3" fill="white" transform="rotate(45,50,50)"/><rect x="22" y="47" width="56" height="6" rx="3" fill="white" transform="rotate(-45,50,50)"/><rect x="43" y="43" width="14" height="14" rx="3" fill="white"/><circle cx="21" cy="21" r="9" fill="white"/><circle cx="79" cy="21" r="9" fill="white"/><circle cx="21" cy="79" r="9" fill="white"/><circle cx="79" cy="79" r="9" fill="white"/>'),
    mapping: { icon: { x: 0, y: 0, width: 100, height: 100, mask: true } },
  },
};

function getIconKey(category: string | null | undefined): keyof typeof ICONS {
  switch (category) {
    case 'A7': return 'helicopter';
    case 'B2': return 'balloon';
    case 'B1': return 'glider';
    case 'B6': return 'drone';
    default:   return 'plane';
  }
}

// ── Airport pin icon ──────────────────────────────────────────────────────────
const AIRPORT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <circle cx="32" cy="32" r="30" fill="#2563eb" stroke="white" stroke-width="2.5"/>
  <path d="M32,10 C34.2,10 35.8,14.5 35.8,19 L35.8,26 L50,32 L50,35.5 L35.8,32 L35.8,38.5 L40,41 L40,44.5 L32,42 L24,44.5 L24,41 L28.2,38.5 L28.2,32 L14,35.5 L14,32 L28.2,26 L28.2,19 C28.2,14.5 29.8,10 32,10Z" fill="white"/>
</svg>`;
const AIRPORT_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(AIRPORT_SVG)}`;
const AIRPORT_ICON_MAPPING = { airport: { x: 0, y: 0, width: 64, height: 64, mask: false } };

// ── View state ────────────────────────────────────────────────────────────────
const INITIAL_VIEW_STATE = {
  longitude: 10,
  latitude: 25,
  zoom: 2,
  pitch: 0,
  bearing: 0,
};

const MAP_STYLE = 'https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json';

// ── Altitude → icon size ──────────────────────────────────────────────────────
function getIconSize(ac: Aircraft, isSelected: boolean): number {
  if (isSelected) return 54;
  if (ac.on_ground) return 18;
  const alt = ac.altitude ?? 0;
  if (alt > 10000) return 36;
  if (alt > 5000) return 30;
  return 24;
}

// Scale icons with zoom level
function zoomSizeScale(zoom: number): number {
  if (zoom <= 2) return 0.18;
  if (zoom <= 3) return 0.28;
  if (zoom <= 4) return 0.45;
  if (zoom <= 5) return 0.65;
  if (zoom <= 6) return 0.85;
  if (zoom <= 7) return 1.0;
  if (zoom <= 8) return 1.3;
  if (zoom <= 9) return 1.7;
  if (zoom <= 10) return 2.1;
  if (zoom <= 12) return 2.6;
  return 3.2;
}

// ── Component ─────────────────────────────────────────────────────────────────
interface MapProps {
  aircraft: Aircraft[];
  trails: TrailEntry[];
  selectedIcao24: string | null;
  selectedTrail: { path: [number, number][]; phase: FlightPhase } | null;
  onSelect: (ac: Aircraft | null) => void;
  trackTarget: { lon: number; lat: number } | null;
}

interface HoverInfo {
  x: number;
  y: number;
  object: Aircraft;
}

interface AirportHoverInfo {
  x: number;
  y: number;
  object: Airport;
}

export function FlightMap({ aircraft, trails, selectedIcao24, selectedTrail, onSelect, trackTarget }: MapProps) {
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [airportHover, setAirportHover] = useState<AirportHoverInfo | null>(null);
  const [pulseScale, setPulseScale] = useState(1);
  const [zoom, setZoom] = useState(INITIAL_VIEW_STATE.zoom);
  const [filterPhase, setFilterPhase] = useState<FlightPhase | null>(null);
  const zoomRef = useRef(INITIAL_VIEW_STATE.zoom);
  const [viewState, setViewState] = useState<object>(INITIAL_VIEW_STATE);
  const [userLocation, setUserLocation] = useState<{ lon: number; lat: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const pulseRef = useRef<number | null>(null);
  const tRef = useRef(0);

  // Pulsing ring animation for selected aircraft
  useEffect(() => {
    if (!selectedIcao24) {
      if (pulseRef.current) cancelAnimationFrame(pulseRef.current);
      return;
    }
    const animate = () => {
      tRef.current += 0.04;
      setPulseScale(1 + 0.35 * Math.abs(Math.sin(tRef.current)));
      pulseRef.current = requestAnimationFrame(animate);
    };
    pulseRef.current = requestAnimationFrame(animate);
    return () => {
      if (pulseRef.current) cancelAnimationFrame(pulseRef.current);
    };
  }, [selectedIcao24]);

  // Auto-follow tracked aircraft whenever its position updates
  const prevTrackRef = useRef<{ lon: number; lat: number } | null>(null);
  const isFirstLockRef = useRef(true);
  useEffect(() => {
    if (!trackTarget) {
      prevTrackRef.current = null;
      isFirstLockRef.current = true;
      return;
    }
    const prev = prevTrackRef.current;
    if (prev && Math.abs(prev.lon - trackTarget.lon) < 0.001 && Math.abs(prev.lat - trackTarget.lat) < 0.001) return;
    prevTrackRef.current = trackTarget;

    if (isFirstLockRef.current) {
      // First lock: fly + zoom in
      isFirstLockRef.current = false;
      setViewState((vs: object) => {
        const current = vs as typeof INITIAL_VIEW_STATE;
        return {
          ...current,
          longitude: trackTarget.lon,
          latitude: trackTarget.lat,
          zoom: Math.max(current.zoom, 7),
          transitionDuration: 1500,
          transitionInterpolator: new FlyToInterpolator(),
        };
      });
    } else {
      // Subsequent updates: pan only — no zoom change, no tile reload
      setViewState((vs: object) => {
        const current = vs as typeof INITIAL_VIEW_STATE;
        return {
          ...current,
          longitude: trackTarget.lon,
          latitude: trackTarget.lat,
          transitionDuration: 800,
          transitionInterpolator: new LinearInterpolator(['longitude', 'latitude']),
        };
      });
    }
  }, [trackTarget]);

  const handleLocateMe = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude, latitude } = pos.coords;
        setUserLocation({ lon: longitude, lat: latitude });
        setViewState({
          longitude,
          latitude,
          zoom: 8,
          pitch: 0,
          bearing: 0,
          transitionDuration: 1200,
          transitionInterpolator: new FlyToInterpolator(),
        });
        setLocating(false);
      },
      () => setLocating(false),
      { timeout: 10000 },
    );
  };

  const layers = useMemo(() => {
    const selectedAircraft = selectedIcao24
      ? aircraft.filter((a) => a.icao24 === selectedIcao24)
      : [];

    // Use full DB trail if available, otherwise fall back to WebSocket trail
    const trailData: TrailEntry[] = selectedTrail
      ? [{ icao24: selectedIcao24 ?? '', path: selectedTrail.path, phase: selectedTrail.phase }]
      : selectedIcao24
        ? trails.filter((t) => t.icao24 === selectedIcao24 && t.path.length > 1)
        : [];

    const trailLayer = new PathLayer<TrailEntry>({
      id: 'aircraft-trails',
      data: trailData,
      pickable: false,
      getPath: (d) => d.path,
      getColor: (d) => { const [r, g, b] = PHASE_COLORS[d.phase]; return [r, g, b, 200]; },
      getWidth: 2,
      widthUnits: 'pixels',
      widthMinPixels: 1,
    });

    const pulseRingOuter = new ScatterplotLayer<Aircraft>({
      id: 'pulse-outer',
      data: selectedAircraft,
      pickable: false,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 5000 * pulseScale,
      radiusUnits: 'meters',
      stroked: true,
      filled: false,
      getLineColor: [255, 255, 100, Math.round(180 / pulseScale)],
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      updateTriggers: { getRadius: [pulseScale], getLineColor: [pulseScale] },
    });

    const pulseRingInner = new ScatterplotLayer<Aircraft>({
      id: 'pulse-inner',
      data: selectedAircraft,
      pickable: false,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 2500,
      radiusUnits: 'meters',
      stroked: true,
      filled: false,
      getLineColor: [255, 255, 100, 200],
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
    });

    const userDotLayer = userLocation
      ? new ScatterplotLayer({
          id: 'user-location',
          data: [userLocation],
          pickable: false,
          getPosition: (d: { lon: number; lat: number }) => [d.lon, d.lat],
          getRadius: 8,
          radiusUnits: 'pixels',
          getFillColor: [66, 153, 225, 255],
          stroked: true,
          getLineColor: [255, 255, 255, 255],
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
        })
      : null;

    const userRingLayer = userLocation
      ? new ScatterplotLayer({
          id: 'user-location-ring',
          data: [userLocation],
          pickable: false,
          getPosition: (d: { lon: number; lat: number }) => [d.lon, d.lat],
          getRadius: 20,
          radiusUnits: 'pixels',
          getFillColor: [66, 153, 225, 40],
          stroked: false,
        })
      : null;

    const baseAircraft = zoom <= 4 ? aircraft.filter((a) => !a.on_ground) : aircraft;
    const visibleAircraft = filterPhase
      ? baseAircraft.filter((a) => a.flight_phase === filterPhase)
      : baseAircraft;

    const iconLayers = (Object.keys(ICONS) as Array<keyof typeof ICONS>).map((key) => {
      const icon = ICONS[key];
      const data = visibleAircraft.filter((a) => getIconKey(a.category) === key);
      return new IconLayer<Aircraft>({
        id: `aircraft-icons-${key}`,
        data,
        pickable: true,
        iconAtlas: icon.url,
        iconMapping: icon.mapping,
        getIcon: () => 'icon',
        getPosition: (d) => [d.lon, d.lat],
        getSize: (d) => getIconSize(d, d.icao24 === selectedIcao24),
        getAngle: (d) => key === 'balloon' ? 0 : -(d.heading ?? 0),
        getColor: (d) =>
          d.icao24 === selectedIcao24
            ? [255, 255, 80, 255]
            : PHASE_COLORS[d.flight_phase],
        sizeUnits: 'pixels',
        sizeScale: zoomSizeScale(zoom),
        updateTriggers: {
          getSize: [selectedIcao24],
          getColor: [selectedIcao24],
        },
      });
    });

    const visibleAirports = AIRPORTS.filter((a) => {
      if (zoom >= 7) return true;
      if (zoom >= 5) return a.tier <= 2;
      if (zoom >= 3) return a.tier === 1;
      return false;
    });

    const airportIconLayer = new IconLayer<Airport>({
      id: 'airport-icons',
      data: visibleAirports,
      pickable: true,
      iconAtlas: AIRPORT_DATA_URL,
      iconMapping: AIRPORT_ICON_MAPPING,
      getIcon: () => 'airport',
      getPosition: (a) => [a.lon, a.lat],
      getSize: (a) => a.tier === 1 ? 32 : a.tier === 2 ? 26 : 22,
      sizeUnits: 'pixels',
      sizeScale: zoom >= 7 ? 1 : zoom >= 5 ? 0.85 : 0.7,
    });

    return [userRingLayer, userDotLayer, airportIconLayer, trailLayer, pulseRingOuter, pulseRingInner, ...iconLayers].filter(Boolean);
  }, [aircraft, trails, selectedIcao24, selectedTrail, pulseScale, zoom, userLocation, filterPhase]);

  const handleClick = (info: PickingInfo) => {
    onSelect(info.object ? (info.object as Aircraft) : null);
  };

  const handleHover = useCallback((info: PickingInfo) => {
    if (info.layer?.id === 'airport-icons') {
      if (info.object && info.x != null && info.y != null) {
        setAirportHover({ x: info.x, y: info.y, object: info.object as Airport });
        setHoverInfo(null);
      } else {
        setAirportHover(null);
      }
    } else {
      if (info.object && info.x != null && info.y != null) {
        setHoverInfo({ x: info.x, y: info.y, object: info.object as Aircraft });
        setAirportHover(null);
      } else {
        setHoverInfo(null);
      }
    }
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <DeckGL
        viewState={viewState as typeof INITIAL_VIEW_STATE}
        controller={true}
        onViewStateChange={({ viewState: vs }) => {
          const newZoom = (vs as typeof INITIAL_VIEW_STATE).zoom;
          zoomRef.current = newZoom;
          setViewState(vs);
          setZoom(newZoom);
        }}
        layers={layers}
        pickingRadius={12}
        onClick={handleClick}
        onHover={handleHover}
        getCursor={({ isHovering }) => isHovering ? 'pointer' : 'grab'}
        style={{ position: 'relative', width: '100%', height: '100%' }}
      >
        <MapLibreMap mapStyle={MAP_STYLE} attributionControl={false} reuseMaps />
      </DeckGL>

      {/* Airport hover tooltip */}
      {airportHover && (
        <div
          style={{
            position: 'absolute',
            left: airportHover.x + 14,
            top: airportHover.y - 48,
            background: 'rgba(10,14,20,0.92)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(37,99,235,0.5)',
            borderRadius: 8,
            padding: '7px 13px',
            color: '#f0f6fc',
            fontSize: 13,
            fontWeight: 600,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 300,
            boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
          }}
        >
          <span style={{ color: '#60a5fa', marginRight: 8, fontFamily: 'monospace', letterSpacing: 1 }}>
            {airportHover.object.iata}
          </span>
          {airportHover.object.name}
          <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 400, marginTop: 2 }}>
            {airportHover.object.city}
          </div>
        </div>
      )}

      {/* Aircraft hover tooltip */}
      {hoverInfo && (
        <div
          style={{
            position: 'absolute',
            left: hoverInfo.x + 14,
            top: hoverInfo.y - 36,
            background: 'rgba(10,14,20,0.92)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            padding: '6px 12px',
            color: '#f0f6fc',
            fontSize: 13,
            fontWeight: 600,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 300,
            letterSpacing: 0.5,
            boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
          }}
        >
          {hoverInfo.object.callsign?.trim() || hoverInfo.object.icao24.toUpperCase()}
          {hoverInfo.object.altitude != null && (
            <span style={{ color: '#8b949e', fontWeight: 400, marginLeft: 10 }}>
              {Math.round(hoverInfo.object.altitude * 3.28084).toLocaleString()} ft
            </span>
          )}
        </div>
      )}

      {/* Locate Me button */}
      <button
        onClick={handleLocateMe}
        disabled={locating}
        style={{
          position: 'absolute',
          bottom: 28,
          right: 16,
          background: 'rgba(10,14,20,0.88)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 10,
          padding: '8px 14px',
          color: locating ? '#8b949e' : '#4299e1',
          fontSize: 13,
          fontWeight: 600,
          cursor: locating ? 'default' : 'pointer',
          zIndex: 100,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          letterSpacing: 0.3,
          transition: 'color 0.2s',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          <circle cx="12" cy="12" r="9" />
        </svg>
        {locating ? 'Locating…' : 'Locate Me'}
      </button>

      {/* Flight phase legend */}
      <div
        style={{
          position: 'absolute',
          bottom: 28,
          left: 16,
          background: 'rgba(10,14,20,0.88)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10,
          padding: '10px 16px',
          zIndex: 100,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ fontSize: 10, color: '#8b949e', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
          Flight Phase
        </div>
        {(Object.keys(PHASE_LABELS) as FlightPhase[]).map((phase) => {
          const [r, g, b] = PHASE_COLORS[phase];
          const isActive = filterPhase === phase;
          const isDimmed = filterPhase !== null && !isActive;
          return (
            <div
              key={phase}
              onClick={() => setFilterPhase(isActive ? null : phase)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 5,
                cursor: 'pointer',
                opacity: isDimmed ? 0.35 : 1,
                transition: 'opacity 0.15s',
                userSelect: 'none',
                padding: '2px 4px',
                borderRadius: 5,
                background: isActive ? `rgba(${r},${g},${b},0.12)` : 'transparent',
                border: isActive ? `1px solid rgba(${r},${g},${b},0.4)` : '1px solid transparent',
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: `rgb(${r},${g},${b})`,
                  boxShadow: `0 0 7px rgba(${r},${g},${b},0.8)`,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: isActive ? `rgb(${r},${g},${b})` : '#c9d1d9', fontSize: 12, fontWeight: isActive ? 600 : 400 }}>
                {PHASE_LABELS[phase]}
              </span>
            </div>
          );
        })}
        {filterPhase && (
          <div
            onClick={() => setFilterPhase(null)}
            style={{
              marginTop: 8,
              fontSize: 10,
              color: '#8b949e',
              cursor: 'pointer',
              textAlign: 'center',
              letterSpacing: 0.5,
              textDecoration: 'underline',
            }}
          >
            Show all
          </div>
        )}
      </div>
    </div>
  );
}
