import { redirect } from "next/navigation";

/** Newsroom removed from primary navigation. */
export default function EventsPage() {
  redirect("/");
}
