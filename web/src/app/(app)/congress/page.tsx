import { redirect } from "next/navigation";

/** Legacy federal Congress route — NYC city gameplay uses Mayor's Office and City Council. */
export default function CongressPage() {
  redirect("/mayor");
}
