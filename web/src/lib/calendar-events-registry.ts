/** Static registry for admin UI (status resolved against simulation_calendar_events at runtime). */
export const CALENDAR_EVENT_DEFINITIONS = [
  { key: "inauguration_2029", label: "Inauguration 2029 — seat Congress, expire bills, open leadership races" },
  { key: "leadership_close_2029", label: "Leadership close (12h after inauguration seating)" },
  { key: "budget_open_2029_09", label: "Budget window — September 2029" },
  { key: "budget_deadline_2029_10", label: "Budget deadline — October 2029 (freeze if no appropriations)" },
  {
    key: "midterms_open_2030",
    label: "2030 midterm election — filings open (first RP November 2030)",
  },
  {
    key: "midterms_seated_2030",
    label: "2030 midterm — seating; RP snaps to January 2031 (new Congress)",
  },
  {
    key: "presidential_election_open_2032",
    label: "2032 presidential election — filings open (first RP November 2032; seating RP January 2033)",
  },
  {
    key: "presidential_seated_2032",
    label: "2032 presidential cycle — seating; RP snaps to January 2033 (new president + Congress)",
  },
  {
    key: "leadership_close_midterm_2030",
    label: "Leadership close — 12h after 2030 midterm seating",
  },
  {
    key: "leadership_close_post_pres_2032",
    label: "Leadership close — 12h after 2032 presidential cycle seating",
  },
  { key: "budget_open_2030_09", label: "Budget window — September 2030" },
  { key: "budget_deadline_2030_10", label: "Budget deadline — October 2030" },
  { key: "budget_open_2031_09", label: "Budget window — September 2031" },
  { key: "budget_deadline_2031_10", label: "Budget deadline — October 2031" },
  { key: "budget_open_2032_09", label: "Budget window — September 2032" },
  { key: "budget_deadline_2032_10", label: "Budget deadline — October 2032" },
  { key: "budget_open_2033_09", label: "Budget window — September 2033" },
  { key: "budget_deadline_2033_10", label: "Budget deadline — October 2033" },
  { key: "budget_open_2034_09", label: "Budget window — September 2034" },
  { key: "budget_deadline_2034_10", label: "Budget deadline — October 2034" },
  { key: "budget_open_2035_09", label: "Budget window — September 2035" },
  { key: "budget_deadline_2035_10", label: "Budget deadline — October 2035" },
  { key: "budget_open_2036_09", label: "Budget window — September 2036" },
  { key: "budget_deadline_2036_10", label: "Budget deadline — October 2036" },
  { key: "budget_open_2037_09", label: "Budget window — September 2037" },
  { key: "budget_deadline_2037_10", label: "Budget deadline — October 2037" },
  { key: "budget_open_2038_09", label: "Budget window — September 2038" },
  { key: "budget_deadline_2038_10", label: "Budget deadline — October 2038" },
] as const;
