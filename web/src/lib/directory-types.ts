/** Shared shape for `/directory` profile cards (real profiles + synthetic placeholders). */
export type DirectoryHolder = {
  id: string;
  character_name: string | null;
  discord_username: string | null;
  party: string | null;
  bio: string | null;
  face_claim_url: string | null;
  residence_state: string | null;
  home_district_code: string | null;
  /** Synthetic roster row — no `/profile/[id]` link. */
  isPlaceholder?: boolean;
};
