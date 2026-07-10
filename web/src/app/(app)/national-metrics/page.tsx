import { redirect } from "next/navigation";

/** Legacy federal national-metrics route — NYC gameplay uses Economy and Mayor's Office. */
export default function NationalMetricsRedirectPage() {
  redirect("/economy");
}
