/**
 * How the job tables on the published site group their columns.
 *
 * The site used to print one column per field — forty-one of them — so a single
 * question like "how do I apply?" was spread over five columns, most of them
 * empty on any given row. This groups the same fields by the decision they
 * serve and stacks them in one cell, in the order a role is judged:
 * what is it, where, how long is left, do I fit, where do I stand, how do I
 * apply, where was it found, what is the school like, what does it pay, who do
 * I write to, and finally the long text.
 *
 * Nothing is dropped. Every field keeps its own line (with its name beside it)
 * inside its group, and a field that is ticked in config/fields.json but not
 * named here still gets a column of its own, so adding a field never makes it
 * vanish. The CSV is written from the flat field list and ignores all of this.
 */

export interface LayoutItem {
  key: string;
  /**
   * The small name shown beside the value. "" means the value stands alone,
   * because the column heading already says what it is.
   */
  label: string;
}

export interface LayoutColumn {
  title: string;
  items: LayoutItem[];
  /** Which field the header sorts by. Defaults to the first item. */
  sort?: string;
  /** Pinned to the left while the table scrolls sideways. */
  sticky?: boolean;
}

const bare = (key: string): LayoutItem => ({ key, label: "" });
const named = (key: string, label: string): LayoutItem => ({ key, label });

export const JOB_LAYOUT: LayoutColumn[] = [
  {
    title: "Role",
    sticky: true,
    sort: "job_title",
    items: [bare("job_title"), bare("school_name"), bare("seniority")],
  },
  {
    title: "Where",
    sort: "country",
    items: [bare("country"), bare("city")],
  },
  {
    title: "Timing",
    sort: "days_left",
    items: [
      bare("days_left"),
      named("last_day", "last day"),
      named("deadline", "deadline"),
      bare("status"),
      named("start_date", "starts"),
      named("contract", "contract"),
    ],
  },
  {
    title: "Fit",
    sort: "fit_score",
    items: [bare("fit"), bare("fit_score"), named("pe_score", "PE match"), named("fit_gaps", "they also want")],
  },
  {
    title: "Me",
    sort: "my_status",
    items: [
      bare("applied"),
      named("my_status", "status"),
      named("my_note", "note"),
      named("application_history", "past"),
    ],
  },
  {
    title: "Apply",
    sort: "apply_type",
    items: [
      named("apply_type", "type"),
      named("application_form", "form to fill?"),
      bare("job_url"),
      bare("apply_url"),
      bare("form_link"),
      bare("careers_page"),
    ],
  },
  {
    title: "Found on",
    sort: "source",
    items: [
      bare("source"),
      named("also_on", "also on"),
      named("posted", "posted"),
      named("first_seen", "first seen"),
      named("last_seen", "last seen"),
    ],
  },
  {
    title: "School",
    sort: "curriculum",
    items: [
      named("curriculum", "curriculum"),
      named("school_type", "type"),
      named("student_count", "students"),
      named("pe_team_size", "PE team"),
      named("pe_roles_seen", "PE roles seen"),
      named("turnover", "turnover"),
      named("accreditation", "accredited"),
      bare("website"),
      named("social", "social"),
    ],
  },
  {
    title: "Pay",
    sort: "salary_estimate",
    items: [
      named("salary_estimate", "salary"),
      named("savings", "saves"),
      named("salary_range", "country range"),
      named("fees", "fees"),
      named("salary_basis", "basis"),
      named("salary_crosscheck", "cross-check"),
    ],
  },
  {
    title: "Contact",
    sort: "career_email",
    items: [
      named("write_to", "write to"),
      named("principal", "principal"),
      named("career_email", "careers"),
      named("school_email", "school"),
      named("best_contact", "best"),
      named("contact_type", "kind"),
      named("phone", "phone"),
      named("all_emails", "all emails"),
    ],
  },
  // Long text sits at the right: the short facts can be scanned first, and the
  // reading is done once a role has earned it.
  { title: "Package & career growth", items: [bare("package")] },
  { title: "What teachers say", items: [bare("reputation")] },
  { title: "Check before sending", items: [bare("letter_flags")] },
  { title: "Prepared email", items: [bare("draft_email")] },
];
