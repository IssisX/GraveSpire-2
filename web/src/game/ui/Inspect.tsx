import { useGame } from "../store.ts";

/**
 * Inspection is where dense engineering information belongs.
 *
 * Every line carries its unit, whether it was measured or estimated, and a
 * confidence. A structural prediction is never dressed up as a reading.
 */
export function InspectPane({ onClose }: { onClose: () => void }) {
  const r = useGame((s) => s.inspect);
  if (!r) return null;
  return (
    <aside className="gs-inspect">
      <header>
        <p>{r.district}</p>
        <h2>{r.title}</h2>
        <button type="button" className="gs-text-btn" onPointerUp={onClose} onClick={onClose}>
          Close
        </button>
      </header>
      <ul>
        {r.lines.map((ln) => (
          <li key={ln.label}>
            <span>{ln.label}</span>
            <strong>
              {ln.value}
              {ln.unit ? ` ${ln.unit}` : ""}
            </strong>
            <em className={ln.source === "measured" ? "is-measured" : "is-estimated"}>
              {ln.source} · {Math.round(ln.confidence * 100)}%
            </em>
          </li>
        ))}
      </ul>
      {r.warning && <p className="gs-warn">{r.warning}</p>}
    </aside>
  );
}
