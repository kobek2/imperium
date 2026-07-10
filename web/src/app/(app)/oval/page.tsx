import { redirect } from "next/navigation";

/** Legacy Oval Office route — NYC mayor actions live in the Mayor's Office. */
export default function OvalRedirectPage() {
  redirect("/mayor");
}
