import type { ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "solar"
  | "new"
  | "info"
  | "warning"
  | "success"
  | "danger"
  | "aeros"
  | "core"
  | "catalyst"
  | "nexus";

/** Small label: "v4.0", "New", "Simplified model", model names, status. */
export function Badge({
  children,
  tone = "neutral",
  dot,
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  /** Show a leading colour dot (useful for model identity). */
  dot?: boolean;
  title?: string;
}) {
  return (
    <span className={`sol-badge sol-badge--${tone}`} title={title}>
      {dot ? <span className="sol-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

const MODEL_META = {
  aeros: { name: "Aeros", version: "4.0" },
  core: { name: "CORe", version: "4.0" },
  catalyst: { name: "Catalyst", version: "1.0" },
  nexus: { name: "Nexus", version: "1.0" },
} as const;

export type ModelId = keyof typeof MODEL_META;

/** Model identity badge, e.g. "Aeros 4.0". */
export function ModelBadge({ model, showVersion = true }: { model: ModelId; showVersion?: boolean }) {
  const m = MODEL_META[model];
  return (
    <Badge tone={model} dot>
      {m.name}
      {showVersion ? <span className="sol-badge__version">{m.version}</span> : null}
    </Badge>
  );
}
