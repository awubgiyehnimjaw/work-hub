import type { CSSProperties } from "react";

export type TeamDotVariant = "filled" | "outline" | "ghost" | "ghost-outline" | "none";

/** Status dot read by shape/weight, never color — matches the mockup's `.td-dot`/`.td-dot.outline`/`.td-dot.ghost`, plus `ghost-outline` for "on hold" (grey outline, distinct from "done"'s solid grey). */
export default function TeamDot({ variant }: { variant: TeamDotVariant }) {
  if (variant === "none") return null;

  const style: CSSProperties = {
    width: 7,
    height: 7,
    borderRadius: 999,
    display: "inline-block",
  };

  if (variant === "filled") {
    style.background = "#111";
  } else if (variant === "outline") {
    style.background = "#fff";
    style.border = "1.5px solid #111";
  } else if (variant === "ghost-outline") {
    style.background = "#fff";
    style.border = "1.5px solid #ccc";
  } else {
    style.background = "#ccc";
  }

  return <span style={style} />;
}
