// Das "Lebensrad" – das zentrale Bildelement der Startseite.
// Jeder Bereich ist ein Segment; die Länge zeigt beispielhaft, wie weit man in diesem Bereich ist.
const AREAS = [
  { label: "Schule", value: 0.72 },
  { label: "Sport", value: 0.85 },
  { label: "Ernährung", value: 0.6 },
  { label: "Finanzen", value: 0.5 },
  { label: "Gewohnheiten", value: 0.9 },
  { label: "Ziele", value: 0.66 },
  { label: "Hobbys", value: 0.78 },
  { label: "Social Media", value: 0.45 },
];

export function LifeWheel() {
  const size = 360;
  const c = size / 2;
  const gap = 4; // Grad Abstand zwischen Segmenten
  const step = 360 / AREAS.length;

  const arc = (r: number, a0: number, a1: number) => {
    const rad = (a: number) => ((a - 90) * Math.PI) / 180;
    const x0 = c + r * Math.cos(rad(a0));
    const y0 = c + r * Math.sin(rad(a0));
    const x1 = c + r * Math.cos(rad(a1));
    const y1 = c + r * Math.sin(rad(a1));
    return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };

  return (
    <svg viewBox={`-85 -12 ${size + 170} ${size + 24}`} className="w-full max-w-[480px]" role="img" aria-label="Beispiel: Fortschritt in acht Lebensbereichen">
      {AREAS.map((area, i) => {
        const start = i * step + gap / 2;
        const end = (i + 1) * step - gap / 2;
        const mid = (start + end) / 2;
        const labelR = 172;
        const rad = ((mid - 90) * Math.PI) / 180;
        return (
          <g key={area.label}>
            {/* Schiene */}
            <path d={arc(118, start, end)} stroke="rgba(42,44,48,.12)" strokeWidth="34" fill="none" />
            {/* Fortschritt: Radius wächst mit dem Wert */}
            <path
              className="wheel-segment"
              style={{ animationDelay: `${i * 70}ms` }}
              d={arc(84 + area.value * 50, start, end)}
              stroke="var(--color-ink)"
              strokeWidth={10}
              strokeLinecap="round"
              fill="none"
            />
            <text
              x={c + labelR * Math.cos(rad)}
              y={c + labelR * Math.sin(rad)}
              textAnchor={Math.abs(Math.cos(rad)) < 0.2 ? "middle" : Math.cos(rad) > 0 ? "start" : "end"}
              dominantBaseline="middle"
              className="fill-ink text-[12px] font-medium"
            >
              {area.label}
            </text>
          </g>
        );
      })}
      <circle cx={c} cy={c} r="62" fill="var(--color-ink)" />
      <text x={c} y={c - 6} textAnchor="middle" className="fill-sun font-display text-[30px] font-extrabold">71%</text>
      <text x={c} y={c + 18} textAnchor="middle" className="fill-white text-[11px]">diese Woche</text>
    </svg>
  );
}
