/**
 * Team data — the ONE place to edit people on the site (landing, welcome dialog, demo page).
 *
 * Optional fields are shown automatically when filled in:
 *   email  → "Email" link on the card
 *   links  → extra links (e.g. LinkedIn, GitHub, personal site)
 *   photo  → path inside web/public/ (e.g. "team/yug.jpg") or an absolute URL; replaces the initials avatar
 *   bio    → one or two sentences under the role
 */
export type TeamLink = { label: string; href: string };

export type TeamMember = {
  name: string;
  /** Initials for the avatar (used when there is no photo). */
  initials: string;
  role: string;
  /** What this person does on Solaris. */
  focus: string;
  affiliation: string;
  kind: "student" | "mentor";
  email?: string;
  links?: TeamLink[];
  photo?: string;
  bio?: string;
};

export const TEAM: TeamMember[] = [
  {
    name: "Yug Patel",
    initials: "YP",
    role: "Technical and coding lead",
    focus: "Builds the models, the in-browser runtime and the platform.",
    affiliation: "Academy of Health Sciences at Prince George’s Community College",
    kind: "student",
  },
  {
    name: "Jeff Minsona Leba",
    initials: "JM",
    role: "Research and scientific framing",
    focus: "Leads the research questions, the station study design and the scientific interpretation.",
    affiliation: "Academy of Health Sciences at Prince George’s Community College",
    kind: "student",
  },
  {
    name: "Kurt Lienau",
    initials: "KL",
    role: "Mentor",
    focus: "Advises the team on research practice and climate-science context.",
    affiliation: "William S. Schmidt Outdoor Education Center",
    kind: "mentor",
  },
];

/** Where the work has been presented. "Presented at" only — no endorsement implied. */
export const PRESENTED_AT = "Presented at a Bowie State climate summit, September 2026";
