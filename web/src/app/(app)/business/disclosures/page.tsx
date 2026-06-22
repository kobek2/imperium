import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function BusinessDisclosuresRedirect() {
  redirect("/economy/pac");
}
