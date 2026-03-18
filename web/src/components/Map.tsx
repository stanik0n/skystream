import { useState, useEffect, useCallback, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { IconLayer, ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import { Map as MapLibreMap } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { PickingInfo } from '@deck.gl/core';
import type { Aircraft, FlightPhase, TrailEntry } from '../types';

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

// ── Detailed top-down aircraft silhouette ─────────────────────────────────────
const PLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <path d="M50,5 C54,5 57,14 57,28 L57,48 L88,61 L88,68 L57,58 L57,73 L67,78 L67,85 L50,80 L33,85 L33,78 L43,73 L43,58 L12,68 L12,61 L43,48 L43,28 C43,14 46,5 50,5Z" fill="white"/>
</svg>`;

const PLANE_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PLANE_SVG)}`;
const ICON_MAPPING = { plane: { x: 0, y: 0, width: 100, height: 100, mask: true } };

// ── View state ────────────────────────────────────────────────────────────────
const INITIAL_VIEW_STATE = {
  longitude: 10,
  latitude: 25,
  zoom: 2,
  pitch: 0,
  bearing: 0,
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// ── Altitude → icon size ──────────────────────────────────────────────────────
function getIconSize(ac: Aircraft, isSelected: boolean): number {
  if (isSelected) return 54;
  if (ac.on_ground) return 18;
  const alt = ac.altitude ?? 0;
  if (alt > 10000) return 36;
  if (alt > 5000) return 30;
  return 24;
}

// ── Component ─────────────────────────────────────────────────────────────────
interface MapProps {
  aircraft: Aircraft[];
  trails: TrailEntry[];
  selectedIcao24: string | null;
  onSelect: (ac: Aircraft | null) => void;
}

interface HoverInfo {
  x: number;
  y: number;
  object: Aircraft;
}

export function FlightMap({ aircraft, trails, selectedIcao24, onSelect }: MapProps) {
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [pulseScale, setPulseScale] = useState(1);
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

  const selectedAircraft = selectedIcao24
    ? aircraft.filter((a) => a.icao24 === selectedIcao24)
    : [];

  // Trail line — only for the selected aircraft
  const selectedTrail = selectedIcao24
    ? trails.filter((t) => t.icao24 === selectedIcao24 && t.path.length > 1)
    : [];

  const trailLayer = new PathLayer<TrailEntry>({
    id: 'aircraft-trails',
    data: selectedTrail,
    pickable: false,
    getPath: (d) => d.path,
    getColor: (d) => {
      const [r, g, b] = PHASE_COLORS[d.phase];
      return [r, g, b, 200];
    },
    getWidth: 2,
    widthUnits: 'pixels',
    widthMinPixels: 1,
  });


  // Animated pulse ring around selected aircraft
  const pulseRingOuter = new ScatterplotLayer<Aircraft>({
    id: 'pulse-outer',
    data: selectedAircraft,
    pickable: false,
    getPosition: (d) => [d.lon, d.lat],
    getRadius: 28000 * pulseScale,
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
    getRadius: 14000,
    radiusUnits: 'meters',
    stroked: true,
    filled: false,
    getLineColor: [255, 255, 100, 200],
    getLineWidth: 1.5,
    lineWidthUnits: 'pixels',
  });

  // Main aircraft icons
  const iconLayer = new IconLayer<Aircraft>({
    id: 'aircraft-icons',
    data: aircraft,
    pickable: true,
    iconAtlas: PLANE_DATA_URL,
    iconMapping: ICON_MAPPING,
    getIcon: () => 'plane',
    getPosition: (d) => [d.lon, d.lat, d.altitude ?? 0],
    getSize: (d) => getIconSize(d, d.icao24 === selectedIcao24),
    getAngle: (d) => -(d.heading ?? 0),
    getColor: (d) =>
      d.icao24 === selectedIcao24
        ? [255, 255, 80, 255]
        : PHASE_COLORS[d.flight_phase],
    sizeUnits: 'pixels',
    sizeScale: 1,
    updateTriggers: {
      getSize: [selectedIcao24],
      getColor: [selectedIcao24],
    },
  });

  const handleClick = (info: PickingInfo) => {
    onSelect(info.object ? (info.object as Aircraft) : null);
  };

  const handleHover = useCallback((info: PickingInfo) => {
    if (info.object && info.x != null && info.y != null) {
      setHoverInfo({ x: info.x, y: info.y, object: info.object as Aircraft });
    } else {
      setHoverInfo(null);
    }
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={[trailLayer, pulseRingOuter, pulseRingInner, iconLayer]}
        onClick={handleClick}
        onHover={handleHover}
        getCursor={({ isHovering }) => isHovering ? 'pointer' : 'grab'}
        style={{ position: 'relative', width: '100%', height: '100%' }}
      >
        <MapLibreMap mapStyle={MAP_STYLE} attributionControl={false} reuseMaps />
      </DeckGL>

      {/* Hover tooltip */}
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
          return (
            <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
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
              <span style={{ color: '#c9d1d9', fontSize: 12 }}>{PHASE_LABELS[phase]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
