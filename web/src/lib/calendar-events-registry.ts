/** Static registry for admin UI (status resolved against simulation_calendar_events at runtime). */
export const CALENDAR_EVENT_DEFINITIONS = [
  { key: "inauguration_2029", label: "Inauguration 2029 — seat Congress, expire bills, open leadership races" },
  { key: "leadership_close_2029", label: "Leadership close (25h after inauguration)" },
  { key: "budget_open_2029_09", label: "Budget window — September 2029" },
  { key: "budget_deadline_2029_10", label: "Budget deadline — October 2029 (freeze if no appropriations)" },
  { key: "midterms_open_2030", label: "Midterm cycle — January 2030" },
  { key: "midterms_seated_2030", label: "Midterm seating — House + Class 2 Senate certified" },
  { key: "presidential_election_open_2031", label: "Presidential cycle — January 2031" },
  { key: "presidential_seated_2031", label: "Presidential cycle seating — House + Class 3 Senate + President" },
  { key: "leadership_close_midterm_2030", label: "Leadership close — 25h after midterm seating (2030 cycle)" },
  { key: "leadership_close_post_pres_2031", label: "Leadership close — 25h after presidential cycle seating (2031)" },
  { key: "budget_open_2030_09", label: "Budget window — September 2030" },
  { key: "budget_deadline_2030_10", label: "Budget deadline — October 2030" },
  { key: "budget_open_2031_09", label: "Budget window — September 2031" },
  { key: "budget_deadline_2031_10", label: "Budget deadline — October 2031" },
  { key: "budget_open_2032_09", label: "Budget window — September 2032" },
  { key: "budget_deadline_2032_10", label: "Budget deadline — October 2032" },
] as const;
