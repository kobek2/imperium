"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { NYC_CITY_CODE } from "@/lib/city";
import { loadCityOfficeSalaryAccrual } from "@/lib/city-office-salary-accrual";

export type CityOfficeSalaryResult = {
  ok: boolean;
  message: string;
  gross?: number;
  cityIncomeTax?: number;
  net?: number;
};

export async function collectCityOfficeSalary(): Promise<CityOfficeSalaryResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("city_collect_office_salary", {
    p_city_code: NYC_CITY_CODE,
  });

  if (error) return { ok: false, message: error.message };

  const payload = data as {
    ok?: boolean;
    message?: string;
    gross?: number;
    city_income_tax?: number;
    net?: number;
  };

  if (!payload.ok) {
    return { ok: false, message: payload.message ?? "Could not collect office salary." };
  }

  for (const p of ["/", "/mayor", "/council", "/economy"]) revalidatePath(p);

  return {
    ok: true,
    message: `Collected $${Number(payload.net ?? 0).toLocaleString()} (city income tax: $${Number(payload.city_income_tax ?? 0).toLocaleString()}).`,
    gross: Number(payload.gross ?? 0),
    cityIncomeTax: Number(payload.city_income_tax ?? 0),
    net: Number(payload.net ?? 0),
  };
}

export async function getCityOfficeSalaryAccrual(): Promise<{
  accruedUsd: number;
  roleKey: string | null;
  accrualCapped: boolean;
  collectionDeadlineAt: string | null;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return loadCityOfficeSalaryAccrual(supabase, user.id);
}
