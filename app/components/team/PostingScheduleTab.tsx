"use client";

import { useMemo, useState } from "react";
import TeamDot, { type TeamDotVariant } from "./TeamDot";
import TeamStatCard from "./TeamStatCard";

export type PostingScheduleStatus = "overdue" | "due-soon" | "upcoming" | "done" | "on-hold";

export interface PostingScheduleEntry {
  entryKey: string;
  client: string;
  video: string;
  postDate: string | null;
  notes: string | null;
  status: PostingScheduleStatus;
}

const STATUS_LABELS: Record<PostingScheduleStatus, string> = {
  overdue: "Overdue",
  "due-soon": "Due soon",
  upcoming: "Upcoming",
  done: "Done",
  "on-hold": "On hold",
};

const STATUS_DOT: Record<PostingScheduleStatus, TeamDotVariant> = {
  overdue: "filled",
  "due-soon": "outline",
  upcoming: "none",
  done: "ghost",
  "on-hold": "ghost-outline",
};

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

export default function PostingScheduleTab({ entries }: { entries: PostingScheduleEntry[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PostingScheduleStatus | "all">("all");
  const [client, setClient] = useState<string | "all">("all");

  const clients = useMemo(() => Array.from(new Set(entries.map((e) => e.client))).sort(), [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (status !== "all" && entry.status !== status) return false;
      if (client !== "all" && entry.client !== client) return false;
      if (q) {
        const haystack = `${entry.client} ${entry.video} ${entry.notes ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [entries, search, status, client]);

  const countByStatus = (s: PostingScheduleStatus) => entries.filter((e) => e.status === s).length;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <TeamStatCard label="Total" value={entries.length} sub={`${clients.length} clients`} />
        <TeamStatCard label="Due soon" value={countByStatus("due-soon")} sub="next 3 days" />
        <TeamStatCard label="Overdue" value={countByStatus("overdue")} sub="needs attention" />
        <TeamStatCard label="Done" value={countByStatus("done")} />
        <TeamStatCard label="On hold" value={countByStatus("on-hold")} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search client, video, or notes…"
          style={{ flex: 1, minWidth: 200, border: "1px solid #e2e2e2", borderRadius: 8, padding: "9px 12px", fontSize: 13 }}
        />
        <button type="button" style={pillStyle(status === "all")} onClick={() => setStatus("all")}>
          All status ({entries.length})
        </button>
        {(Object.keys(STATUS_LABELS) as PostingScheduleStatus[]).map((s) => (
          <button key={s} type="button" style={pillStyle(status === s)} onClick={() => setStatus(s)}>
            {STATUS_LABELS[s]} ({countByStatus(s)})
          </button>
        ))}
        <button type="button" style={pillStyle(client === "all")} onClick={() => setClient("all")}>
          All clients ({clients.length})
        </button>
        {clients.map((c) => (
          <button key={c} type="button" style={pillStyle(client === c)} onClick={() => setClient(c)}>
            {c} ({entries.filter((e) => e.client === c).length})
          </button>
        ))}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {["Client", "Video", "Edit by", "Post date", "Status", "Notes"].map((h) => (
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
              <td colSpan={6} style={{ padding: "16px", textAlign: "center", color: "#595959" }}>
                No matching entries
              </td>
            </tr>
          ) : (
            filtered.map((entry) => (
              <tr key={entry.entryKey}>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>{entry.client}</td>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>{entry.video}</td>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>—</td>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>{entry.postDate ?? "—"}</td>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                    <TeamDot variant={STATUS_DOT[entry.status]} />
                    {STATUS_LABELS[entry.status]}
                  </span>
                </td>
                <td style={{ padding: "12px 16px", borderBottom: "1px solid #e2e2e2" }}>{entry.notes ?? "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
