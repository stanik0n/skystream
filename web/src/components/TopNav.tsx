import { useEffect, useRef, useState } from 'react';
import type { Aircraft } from '../types';

const C = {
  primary: '#c3f5ff',
  primaryContainer: '#00e5ff',
  surface: '#131313',
  surfaceContainerHigh: '#2a2a2a',
  surfaceContainerHighest: '#353534',
  onSurface: '#e5e2e1',
  onSurfaceVariant: '#bac9cc',
  outline: '#849396',
};

interface TopNavProps {
  count: number;
  connected: boolean;
  aircraft: Aircraft[];
  onSearch: (query: string) => boolean;
}

export function TopNav({ count, connected, aircraft, onSearch }: TopNavProps) {
  const [query, setQuery] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const suggestions = query.trim().length >= 2
    ? aircraft.filter((a) => {
        const q = query.toUpperCase();
        return a.callsign?.trim().toUpperCase().startsWith(q) || a.icao24.toUpperCase().startsWith(q);
      }).slice(0, 6)
    : [];

  const handleSearch = (value = query) => {
    if (!value.trim()) return;
    const found = onSearch(value.trim());
    if (!found) {
      setNotFound(true);
      setTimeout(() => setNotFound(false), 2000);
    } else {
      setQuery('');
      setShowSuggestions(false);
    }
  };

  const handleSelect = (ac: Aircraft) => {
    const q = ac.callsign?.trim() || ac.icao24;
    setQuery(q);
    setShowSuggestions(false);
    setActiveIndex(-1);
    handleSearch(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Enter') handleSearch();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, -1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (activeIndex >= 0) handleSelect(suggestions[activeIndex]); else handleSearch(); }
    else if (e.key === 'Escape') { setShowSuggestions(false); setActiveIndex(-1); }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const iconBtn: React.CSSProperties = {
    padding: 8,
    background: 'none',
    border: 'none',
    color: '#52525b',
    cursor: 'pointer',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  };

  return (
    <header style={{
      position: 'fixed',
      top: 0, left: 0, right: 0,
      height: 56,
      zIndex: 50,
      background: 'rgba(19,19,19,0.85)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 24px',
      gap: 16,
    }}>
      {/* Logo + Nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexShrink: 0 }}>
        <h1 style={{
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          color: C.primary,
          textTransform: 'uppercase',
          fontFamily: 'Space Grotesk, sans-serif',
          whiteSpace: 'nowrap',
        }}>SkyStream</h1>
        <nav style={{ display: 'none', gap: 20, alignItems: 'center' }} className="md-nav">
          {['Live Map', 'Fleet', 'Analytics', 'Weather'].map((label, i) => (
            <a key={label} href="#" style={{
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'Space Grotesk, sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              textDecoration: 'none',
              color: i === 0 ? C.primaryContainer : '#52525b',
              borderBottom: i === 0 ? `2px solid ${C.primaryContainer}` : '2px solid transparent',
              paddingBottom: 2,
            }}>{label}</a>
          ))}
        </nav>
      </div>

      {/* Search */}
      <div ref={wrapperRef} style={{ position: 'relative', flex: 1, maxWidth: 440, margin: '0 auto' }}>
        <span className="material-symbols-outlined" style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          color: C.outline, fontSize: 18, pointerEvents: 'none',
        }}>search</span>
        <input
          ref={inputRef}
          style={{
            width: '100%',
            background: C.surfaceContainerHigh,
            border: notFound ? '1px solid rgba(255,100,100,0.5)' : '1px solid transparent',
            borderRadius: 24,
            padding: '7px 140px 7px 38px',
            fontSize: 13,
            color: C.onSurface,
            outline: 'none',
            fontFamily: 'Inter, sans-serif',
            boxSizing: 'border-box',
            transition: 'border-color 0.2s',
          }}
          placeholder="Track flight, tail number, or airport..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase());
            setShowSuggestions(true);
            setActiveIndex(-1);
            setNotFound(false);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => query.trim().length >= 2 && setShowSuggestions(true)}
          spellCheck={false}
        />
        {/* Count badge */}
        <div style={{
          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '3px 10px', borderRadius: 6,
          background: C.surfaceContainerHighest,
          fontSize: 10, fontWeight: 700,
          color: C.primaryContainer,
          fontFamily: 'Inter, sans-serif',
          letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          <span className={connected ? 'sky-pulse' : ''} style={{
            width: 6, height: 6, borderRadius: '50%',
            background: connected ? C.primaryContainer : '#849396',
            display: 'inline-block', flexShrink: 0,
          }} />
          {count.toLocaleString()} ACTIVE
        </div>

        {/* Suggestions */}
        {showSuggestions && suggestions.length > 0 && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'rgba(14,14,14,0.98)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8, overflow: 'hidden', zIndex: 300,
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          }}>
            {suggestions.map((ac, i) => (
              <div
                key={ac.icao24}
                style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '8px 14px', cursor: 'pointer',
                  background: i === activeIndex ? 'rgba(0,229,255,0.1)' : 'transparent',
                  transition: 'background 0.1s',
                }}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(ac); }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif', color: C.onSurface, letterSpacing: 1 }}>
                  {ac.callsign?.trim() || ac.icao24.toUpperCase()}
                </span>
                <span style={{ fontSize: 10, color: C.outline, fontFamily: 'Inter, sans-serif' }}>
                  {ac.icao24.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Icon buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <button style={iconBtn} title="Flights">
          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>flight_takeoff</span>
        </button>
        <button style={iconBtn} title="Notifications">
          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>notifications</span>
        </button>
        <button style={iconBtn} title="Settings">
          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>settings</span>
        </button>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: C.surfaceContainerHigh,
          border: '1px solid rgba(59,73,76,0.8)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginLeft: 4, flexShrink: 0,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.onSurfaceVariant }}>person</span>
        </div>
      </div>
    </header>
  );
}
