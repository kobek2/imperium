import type { SupabaseClient } from "@supabase/supabase-js";
import { POLITICAL_ROLE_LABELS } from "@/config/political-roles";
import {
  formatDistrictPvi,
  NYC_COUNCIL_DISTRICTS,
  type NycCouncilDistrictCode,
} from "@/lib/city";
import {
  ordinanceCategoryLabel,
  ordinanceStanceLabel,
} from "@/lib/city-ordinance-templates";
import type { OrdinanceStanceParams } from "@/lib/city-ordinance-param-score";
import { clampStanceParamsForIssue, issueUsesParametricScoring } from "@/lib/city-ordinance-param-score";
import { mergeCouncilDirectory, loadSeatedCouncilPoliticians } from "@/lib/sim-politicians";
import type { DirectoryHolder } from "@/lib/directory-types";

export type DepartmentHeadRow = {
  departmentKey: string;
  departmentLabel: string;
  politicianId: string | null;
  politicianName: string | null;
  politicianParty: string | null;
  faceClaimUrl: string | null;
  appointedAt: string | null;
  isVacant: boolean;
};

export type AppointableDepartmentHead = {
  id: string;
  slug: string;
  name: string;
  party: string | null;
  bio: string | null;
  faceClaimUrl: string | null;
  currentDepartmentKey: string | null;
};

export type MayorPublicStatementRow = {
  id: string;
  body: string;
  templateKey: string | null;
  issuerName: string;
  createdAt: string;
};

export type MayorExecutiveOrderRow = {
  id: string;
  title: string;
  body: string;
  templateKey: string | null;
  issuerName: string;
  createdAt: string;
};

export type DepartmentReportRow = {
  id: string;
  departmentKey: string;
  departmentLabel: string;
  headName: string;
  faceClaimUrl: string | null;
  title: string;
  body: string;
  reportKind: string;
  createdAt: string;
};

export type DepartmentTaskRow = {
  id: string;
  departmentKey: string;
  departmentLabel: string;
  headName: string | null;
  title: string;
  instructions: string;
  status: string;
  createdAt: string;
};

export type BudgetLineRow = {
  departmentKey: string;
  amountMillions: number;
};

export type CityBudgetRow = {
  id: string;
  fiscalYear: number;
  status: string;
  councilYeas: number;
  councilNays: number;
  proposedAt: string;
  enactedAt: string | null;
  projectedRevenueMillions: number | null;
  projectedExpenditureMillions: number | null;
  projectedDeficitMillions: number | null;
  councilVoteClosesAt: string | null;
  lines: BudgetLineRow[];
  rollCall: OrdinanceRollCallRow[];
};

export type CouncilRosterMember = {
  wardCode: NycCouncilDistrictCode;
  districtName: string;
  borough: string;
  pviLabel: string;
  holderName: string;
  holderParty: string | null;
  faceClaimUrl: string | null;
  holderId: string | null;
  isPlayerHeld: boolean;
};

export type WardDistrictRow = {
  code: string;
  name: string;
  borough: string;
  pvi: number;
  pviLabel: string;
  incumbentName: string | null;
  incumbentParty: string | null;
  faceClaimUrl: string | null;
};

export type OrdinanceRollCallRow = {
  wardCode: string;
  voterLabel: string;
  simPoliticianId: string | null;
  userId: string | null;
  vote: "yea" | "nay" | "pending";
  faceClaimUrl: string | null;
  votedAt: string | null;
};

export type OrdinanceProposalRow = {
  id: string;
  category: string;
  issueKey: string;
  stanceKey: string | null;
  stanceParams: OrdinanceStanceParams | null;
  title: string;
  summary: string;
  status: string;
  councilYeas: number;
  councilNays: number;
  sponsorName: string | null;
  createdAt: string;
  enactedAt: string | null;
  councilVoteClosesAt: string | null;
  rollCall: OrdinanceRollCallRow[];
};

export type CityOfficeData = {
  isMayor: boolean;
  isCouncilMember: boolean;
  departments: DepartmentHeadRow[];
  appointableDepartmentHeads: AppointableDepartmentHead[];
  departmentReports: DepartmentReportRow[];
  publicStatements: MayorPublicStatementRow[];
  executiveOrders: MayorExecutiveOrderRow[];
  openDepartmentTasks: DepartmentTaskRow[];
  pendingBudget: CityBudgetRow | null;
  proposedBudget: CityBudgetRow | null;
  awaitingMayorBudget: CityBudgetRow | null;
  enactedBudgets: CityBudgetRow[];
  councilRoster: CouncilRosterMember[];
  wardDistricts: WardDistrictRow[];
  pendingOrdinance: OrdinanceProposalRow | null;
  pendingOrdinances: OrdinanceProposalRow[];
  awaitingMayorOrdinances: OrdinanceProposalRow[];
  recentOrdinances: OrdinanceProposalRow[];
  enactedOrdinances: OrdinanceProposalRow[];
};

/** @deprecated Use CityOfficeData */
export type MillbrookOfficeData = CityOfficeData;

const DEPT_KEYS = ["finance", "police", "public_works", "parks", "planning"] as const;

function deptLabel(key: string): string {
  const roleKey = `dept_${key}`;
  return POLITICAL_ROLE_LABELS[roleKey] ?? key.replace(/_/g, " ");
}

export async function loadCityOfficeData(
  supabase: SupabaseClient,
  userId: string,
): Promise<CityOfficeData> {
  const [
    { data: grants },
    { data: deptRows },
    { data: budgets },
    { data: wards },
    { data: ordinances },
    { data: enactedOrdinanceRows },
    { data: playerProfiles },
    { data: reportRows },
    { data: taskRows },
    { data: appointableRows },
    { data: statementRows },
    { data: executiveOrderRows },
    seatedCouncil,
  ] = await Promise.all([
    supabase.from("government_role_grants").select("role_key").eq("user_id", userId),
    supabase
      .from("city_department_heads")
      .select(
        "department_key, sim_politician_id, appointed_at, sim_politicians(character_name, party, face_claim_url)",
      )
      .in("department_key", [...DEPT_KEYS]),
    supabase
      .from("city_budgets")
      .select(
        "id, fiscal_year, status, council_yeas, council_nays, created_at, enacted_at, projected_revenue_millions, projected_expenditure_millions, projected_deficit_millions, council_vote_closes_at",
      )
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("wards")
      .select(
        "code, name, pvi, incumbent_party, incumbent_npc_name, incumbent_politician_id, claimed_by, sim_politicians(face_claim_url)",
      )
      .eq("city_code", "MB")
      .order("code"),
    supabase
      .from("city_ordinance_proposals")
      .select(
        "id, sponsor_user_id, category, issue_key, stance_key, stance_params, title, summary, status, council_yeas, council_nays, created_at, enacted_at, council_vote_closes_at",
      )
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("city_ordinance_proposals")
      .select(
        "id, sponsor_user_id, category, issue_key, stance_key, stance_params, title, summary, status, council_yeas, council_nays, created_at, enacted_at, council_vote_closes_at",
      )
      .eq("status", "enacted")
      .order("enacted_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("profiles")
      .select("id, character_name, discord_username, party, face_claim_url, home_district_code")
      .eq("office_role", "council_member"),
    supabase
      .from("city_department_reports")
      .select(
        "id, department_key, title, body, report_kind, created_at, sim_politicians(character_name, face_claim_url)",
      )
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("city_mayor_department_tasks")
      .select("id, department_key, title, instructions, status, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("sim_politicians")
      .select("id, slug, character_name, party, bio, face_claim_url")
      .eq("office", "department_head")
      .order("character_name"),
    supabase
      .from("city_mayor_public_statements")
      .select("id, body, template_key, issued_by, created_at")
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("city_mayor_executive_orders")
      .select("id, title, body, template_key, issued_by, created_at")
      .order("created_at", { ascending: false })
      .limit(12),
    loadSeatedCouncilPoliticians(supabase),
  ]);

  const roleKeys = new Set(grants?.map((g) => g.role_key) ?? []);
  const budgetIds = budgets?.map((b) => b.id) ?? [];
  const { data: budgetLines } = budgetIds.length
    ? await supabase
        .from("city_budget_lines")
        .select("budget_id, department_key, amount_millions")
        .in("budget_id", budgetIds)
    : { data: [] as { budget_id: string; department_key: string; amount_millions: number }[] };

  const linesByBudget = new Map<string, BudgetLineRow[]>();
  for (const line of budgetLines ?? []) {
    const list = linesByBudget.get(line.budget_id) ?? [];
    list.push({
      departmentKey: line.department_key,
      amountMillions: Number(line.amount_millions),
    });
    linesByBudget.set(line.budget_id, list);
  }

  function mapBudget(row: {
    id: string;
    fiscal_year: number;
    status: string;
    council_yeas: number;
    council_nays: number;
    created_at: string;
    enacted_at: string | null;
    projected_revenue_millions?: number | null;
    projected_expenditure_millions?: number | null;
    projected_deficit_millions?: number | null;
    council_vote_closes_at?: string | null;
  }): CityBudgetRow {
    return {
      id: row.id,
      fiscalYear: row.fiscal_year,
      status: row.status,
      councilYeas: row.council_yeas,
      councilNays: row.council_nays,
      proposedAt: row.created_at,
      enactedAt: row.enacted_at,
      projectedRevenueMillions:
        row.projected_revenue_millions != null ? Number(row.projected_revenue_millions) : null,
      projectedExpenditureMillions:
        row.projected_expenditure_millions != null ? Number(row.projected_expenditure_millions) : null,
      projectedDeficitMillions:
        row.projected_deficit_millions != null ? Number(row.projected_deficit_millions) : null,
      councilVoteClosesAt: row.council_vote_closes_at ?? null,
      lines: linesByBudget.get(row.id) ?? [],
      rollCall: [],
    };
  }

  const mappedBudgets = (budgets ?? []).map(mapBudget);

  const departments: DepartmentHeadRow[] = DEPT_KEYS.map((key) => {
    const row = deptRows?.find((d) => d.department_key === key);
    const raw = row?.sim_politicians;
    const sp = (Array.isArray(raw) ? raw[0] : raw) as {
      character_name: string;
      party: string;
      face_claim_url: string | null;
    } | null | undefined;
    const politicianId = row?.sim_politician_id ?? null;
    return {
      departmentKey: key,
      departmentLabel: deptLabel(key),
      politicianId,
      politicianName: sp?.character_name ?? null,
      politicianParty: sp?.party ?? null,
      faceClaimUrl: sp?.face_claim_url ?? null,
      appointedAt: row?.appointed_at ?? null,
      isVacant: !politicianId,
    };
  });

  const headDeptByPoliticianId = new Map(
    departments
      .filter((d) => d.politicianId)
      .map((d) => [d.politicianId as string, d.departmentKey]),
  );

  const appointableDepartmentHeads: AppointableDepartmentHead[] = (appointableRows ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.character_name,
    party: row.party ?? null,
    bio: row.bio ?? null,
    faceClaimUrl: row.face_claim_url ?? null,
    currentDepartmentKey: headDeptByPoliticianId.get(row.id) ?? null,
  }));

  const headByDept = new Map(
    departments.map((d) => [d.departmentKey, { name: d.politicianName, face: d.faceClaimUrl }]),
  );

  const departmentReports: DepartmentReportRow[] = (reportRows ?? []).map((row) => {
    const spRaw = row.sim_politicians;
    const sp = (Array.isArray(spRaw) ? spRaw[0] : spRaw) as {
      character_name: string;
      face_claim_url: string | null;
    } | null;
    const fallback = headByDept.get(row.department_key);
    return {
      id: row.id,
      departmentKey: row.department_key,
      departmentLabel: deptLabel(row.department_key),
      headName: sp?.character_name ?? fallback?.name ?? (row.report_kind === "vacancy" ? "Vacant" : "Department head"),
      faceClaimUrl: sp?.face_claim_url ?? fallback?.face ?? null,
      title: row.title,
      body: row.body,
      reportKind: row.report_kind,
      createdAt: row.created_at,
    };
  });

  const openDepartmentTasks: DepartmentTaskRow[] = (taskRows ?? []).map((row) => {
    const head = headByDept.get(row.department_key);
    return {
      id: row.id,
      departmentKey: row.department_key,
      departmentLabel: deptLabel(row.department_key),
      headName: head?.name ?? null,
      title: row.title,
      instructions: row.instructions,
      status: row.status,
      createdAt: row.created_at,
    };
  });

  const playerCouncilHolders: DirectoryHolder[] = (playerProfiles ?? []).map((p) => ({
    id: p.id,
    character_name: p.character_name,
    discord_username: p.discord_username,
    party: p.party,
    bio: null,
    face_claim_url: p.face_claim_url,
    residence_state: "MB",
    home_district_code: p.home_district_code,
  }));

  const mergedCouncil = mergeCouncilDirectory(playerCouncilHolders, seatedCouncil);
  const councilByWard = new Map(
    mergedCouncil.map((h) => [(h.home_district_code ?? "").toUpperCase(), h]),
  );

  const wardClaimedBy = new Map(
    (wards ?? []).map((w) => [String(w.code).toUpperCase(), w.claimed_by as string | null]),
  );

  const councilRoster: CouncilRosterMember[] = NYC_COUNCIL_DISTRICTS.map((d) => {
    const holder = councilByWard.get(d.code);
    const wardRow = (wards ?? []).find((w) => String(w.code).toUpperCase() === d.code);
    const spRaw = wardRow?.sim_politicians;
    const sp = (Array.isArray(spRaw) ? spRaw[0] : spRaw) as { face_claim_url: string | null } | null;
    const name =
      holder?.character_name ??
      holder?.discord_username ??
      wardRow?.incumbent_npc_name ??
      "Vacant";
    return {
      wardCode: d.code,
      districtName: d.name,
      borough: d.borough,
      pviLabel: formatDistrictPvi(Number(wardRow?.pvi ?? d.pvi)),
      holderName: name,
      holderParty: holder?.party ?? (wardRow?.incumbent_party === "R" ? "republican" : "democrat"),
      faceClaimUrl: holder?.face_claim_url ?? sp?.face_claim_url ?? null,
      holderId: holder?.id ?? null,
      isPlayerHeld: Boolean(wardClaimedBy.get(d.code)),
    };
  });

  const wardDistricts: WardDistrictRow[] = NYC_COUNCIL_DISTRICTS.map((d) => {
    const wardRow = (wards ?? []).find((w) => String(w.code).toUpperCase() === d.code);
    const holder = councilByWard.get(d.code);
    const spRaw = wardRow?.sim_politicians;
    const sp = (Array.isArray(spRaw) ? spRaw[0] : spRaw) as { face_claim_url: string | null } | null;
    const pvi = Number(wardRow?.pvi ?? d.pvi);
    return {
      code: d.code,
      name: wardRow?.name ?? d.name,
      borough: d.borough,
      pvi,
      pviLabel: formatDistrictPvi(pvi),
      incumbentName:
        holder?.character_name ??
        holder?.discord_username ??
        wardRow?.incumbent_npc_name ??
        null,
      incumbentParty:
        holder?.party ?? (wardRow?.incumbent_party === "R" ? "republican" : "democrat"),
      faceClaimUrl: holder?.face_claim_url ?? sp?.face_claim_url ?? null,
    };
  });

  const sponsorIds = [
    ...new Set([
      ...(ordinances ?? []).map((o) => o.sponsor_user_id),
      ...(enactedOrdinanceRows ?? []).map((o) => o.sponsor_user_id),
    ]),
  ];
  const { data: sponsorProfiles } = sponsorIds.length
    ? await supabase
        .from("profiles")
        .select("id, character_name, discord_username")
        .in("id", sponsorIds)
    : { data: [] as { id: string; character_name: string | null; discord_username: string | null }[] };

  const sponsorNameById = new Map(
    (sponsorProfiles ?? []).map((p) => [
      p.id,
      p.character_name?.trim() || p.discord_username?.trim() || "Unknown",
    ]),
  );

  function mapOrdinance(row: {
    id: string;
    sponsor_user_id: string;
    category: string;
    issue_key: string;
    stance_key: string | null;
    stance_params: Record<string, unknown> | null;
    title: string;
    summary: string;
    status: string;
    council_yeas: number;
    council_nays: number;
    created_at: string;
    enacted_at?: string | null;
    council_vote_closes_at?: string | null;
  }): OrdinanceProposalRow {
    return {
      id: row.id,
      category: row.category,
      issueKey: row.issue_key,
      stanceKey: row.stance_key,
      stanceParams: row.stance_params
        ? issueUsesParametricScoring(row.issue_key)
          ? clampStanceParamsForIssue(row.issue_key, row.stance_params as Partial<OrdinanceStanceParams>)
          : (row.stance_params as OrdinanceStanceParams)
        : null,
      title: row.title,
      summary: row.summary,
      status: row.status,
      councilYeas: row.council_yeas,
      councilNays: row.council_nays,
      sponsorName: sponsorNameById.get(row.sponsor_user_id) ?? null,
      createdAt: row.created_at,
      enactedAt: row.enacted_at ?? null,
      councilVoteClosesAt: row.council_vote_closes_at ?? null,
      rollCall: [],
    };
  }

  const ordinanceIds = [
    ...new Set([
      ...(ordinances ?? []).map((o) => o.id),
      ...(enactedOrdinanceRows ?? []).map((o) => o.id),
    ]),
  ];
  const pendingOrdinanceIds = (ordinances ?? [])
    .filter((o) => o.status === "council_vote")
    .map((o) => o.id);

  const [{ data: rollCallRows }, { data: memberVoteRows }] = await Promise.all([
    ordinanceIds.length
      ? supabase
          .from("city_ordinance_roll_calls")
          .select(
            "proposal_id, ward_code, voter_label, sim_politician_id, user_id, vote, voted_at",
          )
          .in("proposal_id", ordinanceIds)
          .order("ward_code")
      : Promise.resolve({ data: [] as {
          proposal_id: string;
          ward_code: string;
          voter_label: string;
          sim_politician_id: string | null;
          user_id: string | null;
          vote: string;
          voted_at: string;
        }[] }),
    pendingOrdinanceIds.length
      ? supabase
          .from("city_ordinance_member_votes")
          .select("proposal_id, user_id, vote, voted_at")
          .in("proposal_id", pendingOrdinanceIds)
      : Promise.resolve({ data: [] as {
          proposal_id: string;
          user_id: string;
          vote: string;
          voted_at: string;
        }[] }),
  ]);

  const rollCallsByProposal = new Map<string, OrdinanceRollCallRow[]>();
  for (const row of rollCallRows ?? []) {
    const roster = councilRoster.find(
      (m) => m.wardCode.toUpperCase() === String(row.ward_code).toUpperCase(),
    );
    const list = rollCallsByProposal.get(row.proposal_id) ?? [];
    list.push({
      wardCode: String(row.ward_code).toUpperCase(),
      voterLabel: row.voter_label,
      simPoliticianId: row.sim_politician_id,
      userId: row.user_id,
      vote: row.vote === "yea" ? "yea" : "nay",
      faceClaimUrl: roster?.faceClaimUrl ?? null,
      votedAt: row.voted_at,
    });
    rollCallsByProposal.set(row.proposal_id, list);
  }

  const playerVotesByProposal = new Map<
    string,
    Map<string, { vote: "yea" | "nay"; votedAt: string }>
  >();
  for (const row of memberVoteRows ?? []) {
    const byUser = playerVotesByProposal.get(row.proposal_id) ?? new Map();
    byUser.set(row.user_id, { vote: row.vote as "yea" | "nay", votedAt: row.voted_at });
    playerVotesByProposal.set(row.proposal_id, byUser);
  }

  function buildPendingRollCall(proposalId: string): OrdinanceRollCallRow[] {
    const playerVotesByUserId = playerVotesByProposal.get(proposalId) ?? new Map();
    return councilRoster.map((member) => {
      const playerVote = member.holderId ? playerVotesByUserId.get(member.holderId) : undefined;
      return {
        wardCode: member.wardCode,
        voterLabel: member.holderName,
        simPoliticianId: null,
        userId: member.holderId,
        vote: playerVote?.vote ?? "pending",
        faceClaimUrl: member.faceClaimUrl,
        votedAt: playerVote?.votedAt ?? null,
      };
    });
  }

  function attachRollCall(row: OrdinanceProposalRow): OrdinanceProposalRow {
    if (row.status === "council_vote") {
      return { ...row, rollCall: buildPendingRollCall(row.id) };
    }
    const saved = rollCallsByProposal.get(row.id) ?? [];
    return {
      ...row,
      rollCall: saved.length > 0 ? saved : [],
    };
  }

  const mappedOrdinances = (ordinances ?? []).map(mapOrdinance).map(attachRollCall);
  const pendingOrdinances = mappedOrdinances.filter((o) => o.status === "council_vote");
  const pendingOrdinance = pendingOrdinances[0] ?? null;
  const awaitingMayorOrdinances = mappedOrdinances.filter((o) => o.status === "awaiting_mayor");
  const enactedOrdinances = (enactedOrdinanceRows ?? [])
    .map(mapOrdinance)
    .map(attachRollCall)
    .sort((a, b) => (b.enactedAt ?? b.createdAt).localeCompare(a.enactedAt ?? a.createdAt));
  const recentOrdinances = mappedOrdinances;

  const pendingBudgetId = mappedBudgets.find((b) => b.status === "council_vote")?.id ?? null;
  const budgetIdsForRollCall = mappedBudgets.map((b) => b.id);

  const [{ data: budgetRollCallRows }, { data: budgetMemberVoteRows }] = await Promise.all([
    budgetIdsForRollCall.length
      ? supabase
          .from("city_budget_roll_calls")
          .select(
            "budget_id, ward_code, voter_label, sim_politician_id, user_id, vote, voted_at",
          )
          .in("budget_id", budgetIdsForRollCall)
          .order("ward_code")
      : Promise.resolve({ data: [] as {
          budget_id: string;
          ward_code: string;
          voter_label: string;
          sim_politician_id: string | null;
          user_id: string | null;
          vote: string;
          voted_at: string;
        }[] }),
    pendingBudgetId
      ? supabase
          .from("city_budget_member_votes")
          .select("user_id, vote, voted_at")
          .eq("budget_id", pendingBudgetId)
      : Promise.resolve({ data: [] as { user_id: string; vote: string; voted_at: string }[] }),
  ]);

  const rollCallsByBudget = new Map<string, OrdinanceRollCallRow[]>();
  for (const row of budgetRollCallRows ?? []) {
    const roster = councilRoster.find(
      (m) => m.wardCode.toUpperCase() === String(row.ward_code).toUpperCase(),
    );
    const list = rollCallsByBudget.get(row.budget_id) ?? [];
    list.push({
      wardCode: String(row.ward_code).toUpperCase(),
      voterLabel: row.voter_label,
      simPoliticianId: row.sim_politician_id,
      userId: row.user_id,
      vote: row.vote === "yea" ? "yea" : "nay",
      faceClaimUrl: roster?.faceClaimUrl ?? null,
      votedAt: row.voted_at,
    });
    rollCallsByBudget.set(row.budget_id, list);
  }

  const budgetPlayerVotesByUserId = new Map(
    (budgetMemberVoteRows ?? []).map((v) => [
      v.user_id,
      { vote: v.vote as "yea" | "nay", votedAt: v.voted_at },
    ]),
  );

  function buildPendingBudgetRollCall(): OrdinanceRollCallRow[] {
    return councilRoster.map((member) => {
      const playerVote = member.holderId ? budgetPlayerVotesByUserId.get(member.holderId) : undefined;
      return {
        wardCode: member.wardCode,
        voterLabel: member.holderName,
        simPoliticianId: null,
        userId: member.holderId,
        vote: playerVote?.vote ?? "pending",
        faceClaimUrl: member.faceClaimUrl,
        votedAt: playerVote?.votedAt ?? null,
      };
    });
  }

  const pendingBudgetRollCall = pendingBudgetId ? buildPendingBudgetRollCall() : [];

  function attachBudgetRollCall(row: CityBudgetRow): CityBudgetRow {
    if (row.status === "council_vote") {
      return { ...row, rollCall: pendingBudgetRollCall };
    }
    const saved = rollCallsByBudget.get(row.id) ?? [];
    return { ...row, rollCall: saved };
  }

  const budgetsWithRollCall = mappedBudgets.map(attachBudgetRollCall);
  const pendingBudget = budgetsWithRollCall.find((b) => b.status === "council_vote") ?? null;
  const proposedBudget = budgetsWithRollCall.find((b) => b.status === "proposed") ?? null;
  const awaitingMayorBudget =
    budgetsWithRollCall.find((b) => b.status === "awaiting_mayor") ?? null;
  const enactedBudgets = budgetsWithRollCall.filter((b) => b.status === "enacted");

  const issuerIds = [
    ...new Set([
      ...(statementRows ?? []).map((r) => r.issued_by),
      ...(executiveOrderRows ?? []).map((r) => r.issued_by),
    ]),
  ];
  const { data: issuerProfiles } = issuerIds.length
    ? await supabase
        .from("profiles")
        .select("id, character_name, discord_username")
        .in("id", issuerIds)
    : { data: [] as { id: string; character_name: string | null; discord_username: string | null }[] };

  const issuerNameById = new Map(
    (issuerProfiles ?? []).map((p) => [
      p.id,
      p.character_name?.trim() || p.discord_username?.trim() || "Mayor",
    ]),
  );

  const publicStatements: MayorPublicStatementRow[] = (statementRows ?? []).map((row) => ({
    id: row.id,
    body: row.body,
    templateKey: row.template_key ?? null,
    issuerName: issuerNameById.get(row.issued_by) ?? "Mayor",
    createdAt: row.created_at,
  }));

  const executiveOrders: MayorExecutiveOrderRow[] = (executiveOrderRows ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    templateKey: row.template_key ?? null,
    issuerName: issuerNameById.get(row.issued_by) ?? "Mayor",
    createdAt: row.created_at,
  }));

  return {
    isMayor: roleKeys.has("mayor") || roleKeys.has("admin"),
    isCouncilMember: roleKeys.has("council_member") || roleKeys.has("admin"),
    departments,
    appointableDepartmentHeads,
    departmentReports,
    publicStatements,
    executiveOrders,
    openDepartmentTasks,
    pendingBudget,
    proposedBudget,
    awaitingMayorBudget,
    enactedBudgets,
    councilRoster,
    wardDistricts,
    pendingOrdinance,
    pendingOrdinances,
    awaitingMayorOrdinances,
    recentOrdinances,
    enactedOrdinances,
  };
}

/** @deprecated Use loadCityOfficeData */
export async function loadMillbrookOfficeData(
  supabase: SupabaseClient,
  userId: string,
): Promise<CityOfficeData> {
  return loadCityOfficeData(supabase, userId);
}

export type DirectoryEnactedOrdinance = {
  id: string;
  title: string;
  category: string;
  categoryLabel: string;
  stanceLabel: string;
  enactedAt: string;
  createdAt: string;
  councilYeas: number;
  councilNays: number;
  sponsorName: string | null;
};

/** Enacted city ordinances for the directory City Hall tab. */
export async function loadEnactedOrdinancesForDirectory(
  supabase: SupabaseClient,
): Promise<DirectoryEnactedOrdinance[]> {
  const { data: rows, error } = await supabase
    .from("city_ordinance_proposals")
    .select(
      "id, sponsor_user_id, category, issue_key, stance_key, stance_params, title, council_yeas, council_nays, created_at, enacted_at",
    )
    .eq("status", "enacted")
    .order("enacted_at", { ascending: false, nullsFirst: false });

  if (error) {
    console.warn("[city-office-data] enacted ordinances:", error.message);
    return [];
  }

  const sponsorIds = [...new Set((rows ?? []).map((r) => r.sponsor_user_id))];
  const { data: sponsorProfiles } = sponsorIds.length
    ? await supabase
        .from("profiles")
        .select("id, character_name, discord_username")
        .in("id", sponsorIds)
    : { data: [] as { id: string; character_name: string | null; discord_username: string | null }[] };

  const sponsorNameById = new Map(
    (sponsorProfiles ?? []).map((p) => [
      p.id,
      p.character_name?.trim() || p.discord_username?.trim() || null,
    ]),
  );

  return (rows ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    categoryLabel: ordinanceCategoryLabel(row.category),
    stanceLabel: ordinanceStanceLabel(
      row.category,
      row.issue_key,
      row.stance_key,
      row.stance_params as { rate_delta?: number; earmark_services_pct?: number } | null,
    ),
    enactedAt: row.enacted_at ?? row.created_at,
    createdAt: row.created_at,
    councilYeas: row.council_yeas,
    councilNays: row.council_nays,
    sponsorName: sponsorNameById.get(row.sponsor_user_id) ?? null,
  }));
}

/** Ward district rows for directory / onboarding panels (DB-backed with static fallback). */
export async function loadWardDistrictRows(supabase: SupabaseClient): Promise<WardDistrictRow[]> {
  const { data: wards, error } = await supabase
    .from("wards")
    .select(
      "code, name, pvi, incumbent_party, incumbent_npc_name, sim_politicians(face_claim_url)",
    )
    .eq("city_code", "MB")
    .order("code");

  if (error) {
    console.warn("[city-office-data] wards:", error.message);
  }

  return NYC_COUNCIL_DISTRICTS.map((d) => {
    const wardRow = (wards ?? []).find((w) => String(w.code).toUpperCase() === d.code);
    const spRaw = wardRow?.sim_politicians;
    const sp = (Array.isArray(spRaw) ? spRaw[0] : spRaw) as { face_claim_url: string | null } | null;
    const pvi = Number(wardRow?.pvi ?? d.pvi);
    return {
      code: d.code,
      name: wardRow?.name ?? d.name,
      borough: d.borough,
      pvi,
      pviLabel: formatDistrictPvi(pvi),
      incumbentName: wardRow?.incumbent_npc_name ?? d.incumbentName ?? null,
      incumbentParty:
        wardRow?.incumbent_party === "R"
          ? "republican"
          : wardRow?.incumbent_party === "D"
            ? "democrat"
            : (d.incumbentParty ?? null),
      faceClaimUrl: sp?.face_claim_url ?? null,
    };
  });
}
