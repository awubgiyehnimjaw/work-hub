"use client";

import { useMemo, useState } from "react";
import TeamDot from "./TeamDot";
import TeamStatCard from "./TeamStatCard";

export interface ReviewTask {
  id: string;
  title: string;
  clientName: string | null;
  isStale: boolean;
}

type StaleFilter = "all" | "stale" | "not-stale";

const pillStyle = (on: boolean) => ({
  padding: "7px 12px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600 as const,
  border: "1px solid #e2e2e2",
  background: on ? "#111" : "#fff",
  color: on ? "#fff" : "#111",
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
});

export default function ReviewsTab({ reviews }: { reviews: ReviewTask[] }) {
  const [search, setSearch] = useState("");
  const [staleFilter, setStaleFilter] = useState<StaleFilter>("all");
  const [client, setClient] = useState<string | "all">("all");

  const clients = useMemo(
    () => Array.from(new Set(reviews.map((r) => r.clientName).filter((c): c is string => c !== null))).sort(),
    [reviews],
  );

  const staleCount = reviews.filter((r) => r.isStale).length;
  const notStaleCount = reviews.length - staleCount;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reviews.filter((review) => {
      if (staleFilter === "stale" && !review.isStale) return false;
      if (staleFilter === "not-stale" && review.isStale) return false;
      if (client !== "all" && review.clientName !== client) return false;
      if (q) {
        const haystack = `${review.title} ${review.clientName ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [reviews, search, staleFilter, client]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
        <TeamStatCard label="Total active" value={reviews.length} />
        <TeamStatCard label="Stale" value={staleCount} />
        <TeamStatCard label="Not stale" value={notStaleCount} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or client…"
          style={{ flex: 1, minWidth: 200, border: "1px solid #e2e2e2", borderRadius: 8, padding: "9px 12px", fontSize: 13 }}
        />
        <button type="button" style={pillStyle(staleFilter === "all")} onClick={() => setStaleFilter("all")}>
          All ({reviews.length})
        </button>
        <button type="button" style={pillStyle(staleFilter === "stale")} onClick={() => setStaleFilter("stale")}>
          Stale ({staleCount})
        </button>
        <button type="button" style={pillStyle(staleFilter === "not-stale")} onClick={() => setStaleFilter("not-stale")}>
          Not stale ({notStaleCount})
        </button>
        <button type="button" style={pillStyle(client === "all")} onClick={() => setClient("all")}>
          All clients ({clients.length})
        </button>
        {clients.map((c) => (
          <button key={c} type="button" style={pillStyle(client === c)} onClick={() => setClient(c)}>
            {c} ({reviews.filter((r) => r.clientName === c).length})
          </button>
        ))}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {["Client", "Title", "Status"].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  color: "#595959",
                  padding: "10px 16px",
                  borderTop: "1px solid #e2e2e2",
                  borderBottom: "1px solid #e2e2e2",
                  background: "#f6f6f6",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ padding: "16px", textAlign: "center", color: "#595959" }}>
                No matching entries
              </td>
            </tr>
          ) : (
            filtered.map((review) => (
              <tr key={review.id}>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>{review.clientName ?? "—"}</td>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>{review.title}</td>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                    <TeamDot variant={review.isStale ? "filled" : "none"} />
                    {review.isStale ? "Stale" : "Not stale"}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
