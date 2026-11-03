export type IssueSeverity = "error" | "warn" | "info";

/**
 * One "idea for a fix" — a conclusion drawn from report metrics, not an
 * applied change. See ./README.md for the full catalog these are drawn from.
 */
export interface Issue {
  id: string;
  severity: IssueSeverity;
  title: string;
  message: string;
  recommendation: string;
  /** Repo-root-relative doc paths that justify/expand on this issue. */
  docs: string[];
}
