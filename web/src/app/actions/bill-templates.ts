"use server";

import { createClient } from "@/lib/supabase/server";

export type BillTemplateRow = {
  id: string;
  issue_key: string;
  display_name: string;
  description: string | null;
  stances: unknown;
};

export async function listBillTemplates(): Promise<BillTemplateRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bill_templates")
    .select("id, issue_key, display_name, description, stances")
    .order("display_name", { ascending: true });
  if (error) {
    console.warn("[listBillTemplates]", error.message);
    return [];
  }
  return (data ?? []) as BillTemplateRow[];
}
