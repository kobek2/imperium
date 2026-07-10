import { redirect } from "next/navigation";

/** PAC fundraising disabled this season — stocks and wallet economy remain active. */
export default function EconomyPacPage() {
  redirect("/economy");
}
