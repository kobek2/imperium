/**
 * Cabinet seats the President may nominate via Oval → Senate confirmation.
 * Keep in sync with the "Cabinet" grid on `/directory`.
 */
export const CABINET_APPOINTMENT_ROLE_KEYS = [
  "chief_of_staff",
  "secretary_of_state",
  "secretary_of_treasury",
  "attorney_general",
  "secretary_of_defense",
  "secretary_of_homeland_security",
  "secretary_of_health_and_human_services",
  "secretary_of_transportation",
  "secretary_of_energy",
  "secretary_of_interior",
  "secretary_of_agriculture",
  "secretary_of_commerce",
  "secretary_of_education",
  "secretary_of_veterans_affairs",
  "secretary_of_housing_and_urban_development",
] as const;

export type CabinetAppointmentRoleKey = (typeof CABINET_APPOINTMENT_ROLE_KEYS)[number];

export const CABINET_APPOINTMENT_ROLE_KEY_SET = new Set<string>(CABINET_APPOINTMENT_ROLE_KEYS);
