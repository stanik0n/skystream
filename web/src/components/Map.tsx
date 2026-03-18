import DeckGL from '@deck.gl/react';
import { IconLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Map as MapLibreMap } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { PickingInfo } from '@deck.gl/core';
import type { Aircraft, FlightPhase } from '../types';

// ── Phase → RGBA colour mapping ───────────────────────────────────────────────
const PHASE_COLORS: Record<FlightPhase, [number, number, number, number]> = {
  GROUND:     [150, 150, 150, 220],
  CLIMBING:   [0,   200, 100, 230],
  CRUISE:     [30,  144, 255, 230],
  DESCENDING: [255, 165, 0,   230],
};

// ── Inline plane SVG as a data URL for IconLayer ──────────────────────────────
// A simple aircraft silhouette viewed from above.
const PLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <polygon points="32,2 38,30 62,38 38,42 36,62 32,54 28,62 26,42 2,38 26,30" fill="white"/>
</svg>`;

const PLANE_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PLANE_SVG)}`;

const ICON_MAPPING = {
  plane: { x: 0, y: 0, width: 64, height: 64, mask: true },
};

const INITIAL_VIEW_STATE = {
  longitude: -98.5795,
  latitude:  39.8283,
  zoom:       4,
  pitch:      0,
  bearing:    0,
};

const MAP_STYLE =
  import.meta.env.VITE_MAPLIBRE_STYLE_URL ||
  'https://tiles.openfreemap.org/styles/liberty';

interface MapProps {
  aircraft: Aircraft[];
  selectedIcao24: string | null;
  onSelect: (ac: Aircraft | null) => void;
}

export function FlightMap({ aircraft, selectedIcao24, onSelect }: MapProps) {
  const iconLayer = new IconLayer<Aircraft>({
    id: 'aircraft-icons',
    data: aircraft,
    pickable: true,
    iconAtlas: PLANE_DATA_URL,
    iconMapping: ICON_MAPPING,
    getIcon: () => 'plane',
    getPosition: (d) => [d.lon, d.lat, d.altitude ?? 0],
    getSize: (d) => (d.icao24 === selectedIcao24 ? 40 : 28),
    getAngle: (d) => -(d.heading ?? 0),
    getColor: (d) =>
      d.icao24 === selectedIcao24
        ? [255, 255, 0, 255]
        : PHASE_COLORS[d.flight_phase],
    sizeUnits: 'pixels',
    sizeScale: 1,
    updateTriggers: {
      getSize:  [selectedIcao24],
      getColor: [selectedIcao24],
    },
  });

  // Scatterplot fallback for browsers where SVG icons fail.
  const scatterLayer = new ScatterplotLayer<Aircraft>({
    id: 'aircraft-scatter-fallback',
    data: aircraft,
    pickable: false,
    visible: false, // flip to true for debugging
    getPosition: (d) => [d.lon, d.lat],
    getRadius: 8000,
    getFillColor: (d) => PHASE_COLORS[d.flight_phase],
    radiusUnits: 'meters',
  });

  const handleClick = (info: PickingInfo) => {
    if (info.object) {
      onSelect(info.object as Aircraft);
    } else {
      onSelect(null);
    }
  };

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={[scatterLayer, iconLayer]}
      onClick={handleClick}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <MapLibreMap
        mapStyle={MAP_STYLE}
        attributionControl={false}
        reuseMaps
      />
    </DeckGL>
  );
}
