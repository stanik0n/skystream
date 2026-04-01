export function LeftSidebar() {
  const items = [
    { icon: 'map', label: 'Map', active: true },
    { icon: 'air', label: 'Fleet', active: false },
    { icon: 'monitoring', label: 'Data', active: false },
    { icon: 'thunderstorm', label: 'WX', active: false },
  ];

  return (
    <aside style={{
      position: 'fixed',
      left: 0, top: 56, bottom: 0,
      width: 80,
      zIndex: 40,
      background: 'rgba(14,14,14,0.5)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%' }}>
        {items.map(({ icon, label, active }) => (
          <button key={icon} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: '16px 0',
            width: '100%',
            background: active ? 'rgba(0,229,255,0.08)' : 'none',
            border: 'none',
            borderLeft: active ? '3px solid #00e5ff' : '3px solid transparent',
            color: active ? '#00e5ff' : '#52525b',
            cursor: 'pointer',
            transition: 'color 0.2s, background 0.2s',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>{icon}</span>
            <span style={{
              fontSize: 9,
              fontFamily: 'Space Grotesk, sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              fontWeight: 600,
            }}>{label}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 0 24px' }}>
        {['help_center', 'logout'].map((icon) => (
          <button key={icon} style={{
            background: 'none', border: 'none',
            color: '#52525b', cursor: 'pointer',
            padding: '10px 0', width: 80,
            display: 'flex', justifyContent: 'center',
            transition: 'color 0.2s',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>{icon}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
