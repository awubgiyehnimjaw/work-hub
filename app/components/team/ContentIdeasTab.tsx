"use client";

import { useMemo, useState } from "react";
import TeamStatCard from "./TeamStatCard";

export interface ContentIdea {
  id: string;
  text: string;
  clientName: string | null;
  createdAt: string;
}

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

export default function ContentIdeasTab({ ideas }: { ideas: ContentIdea[] }) {
  const [search, setSearch] = useState("");
  const [client, setClient] = useState<string | "all">("all");

  const clients = useMemo(
    () => Array.from(new Set(ideas.map((i) => i.clientName).filter((c): c is string => c !== null))).sort(),
    [ideas],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ideas.filter((idea) => {
      if (client !== "all" && idea.clientName !== client) return false;
      if (q) {
        const haystack = `${idea.text} ${idea.clientName ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [ideas, search, client]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(clients.length + 1, 5)}, 1fr)`, gap: 12, marginBottom: 16 }}>
        <TeamStatCard label="Total" value={ideas.length} />
        {clients.map((c) => (
          <TeamStatCard key={c} label={c} value={ideas.filter((i) => i.clientName === c).length} />
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search idea or client…"
          style={{ flex: 1, minWidth: 200, border: "1px solid #e2e2e2", borderRadius: 8, padding: "9px 12px", fontSize: 13 }}
        />
        <button type="button" style={pillStyle(client === "all")} onClick={() => setClient("all")}>
          All clients ({clients.length})
        </button>
        {clients.map((c) => (
          <button key={c} type="button" style={pillStyle(client === c)} onClick={() => setClient(c)}>
            {c} ({ideas.filter((i) => i.clientName === c).length})
          </button>
        ))}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {["Client", "Idea", "Logged"].map((h) => (
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
            filtered.map((idea) => (
              <tr key={idea.id}>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>{idea.clientName ?? "—"}</td>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>{idea.text}</td>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>
                  {new Date(idea.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
