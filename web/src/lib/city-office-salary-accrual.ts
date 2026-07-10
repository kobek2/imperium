import type { SupabaseClient } from "@supabase/supabase-js";
import { NYC_CITY_CODE } from "@/lib/city";

export type CityOfficeSalaryAccrual = {
  accruedUsd: number;
  roleKey: string | null;
  accrualCapped: boolean;
  collectionDeadlineAt: string | null;
};

export async function loadCityOfficeSalaryAccrual(
  supabase: SupabaseClient,
  userId: string,
): Promise<CityOfficeSalaryAccrual> {
  try {
    await supabase.rpc("refresh_city_office_salary_accruals", { p_city_code: NYC_CITY_CODE });
  } catch (err) {
    console.warn("[city-office-salary-accrual] refresh:", err);
  }

  const { data, error } = await supabase
    .from("city_office_salary_ledger")
    .select("accrued_usd, role_key, accrual_capped, collection_deadline_at, collected_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[city-office-salary-accrual] ledger:", error.message);
    return { accruedUsd: 0, roleKey: null, accrualCapped: false, collectionDeadlineAt: null };
  }

  if (!data) {
    return { accruedUsd: 0, roleKey: null, accrualCapped: false, collectionDeadlineAt: null };
  }

  return {
    accruedUsd: Number(data.accrued_usd ?? 0),
    roleKey: data.role_key ?? null,
    accrualCapped: Boolean(data.accrual_capped),
    collectionDeadlineAt: data.collection_deadline_at ?? null,
  };
}
