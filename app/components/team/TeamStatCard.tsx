interface TeamStatCardProps {
  label: string;
  value: number;
  sub?: string;
  active?: boolean;
}

/** A single black-and-white stat card for the team dashboard, matching the approved mockup's `.td-stat`. */
export default function TeamStatCard({ label, value, sub, active }: TeamStatCardProps) {
  return (
    <div
      style={{
        border: "1px solid #e2e2e2",
        borderRadius: 10,
        padding: "14px 16px",
        background: active ? "#111" : "#fff",
        color: active ? "#fff" : "#111",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: active ? "#ccc" : "#595959" }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{value}</div>
      {sub ? (
        <div style={{ fontSize: 12, marginTop: 2, color: active ? "#ddd" : "#595959" }}>{sub}</div>
      ) : null}
    </div>
  );
}
