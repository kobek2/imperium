export type CampaignActionResult = {
  npc_speech: boolean;
  npc_counter_attack: boolean;
  player_points_delta: number;
  opponent_points_delta: number;
  action_points_awarded: number;
  action_label: string;
};

export function formatCampaignActionResult(result: CampaignActionResult): string {
  const parts: string[] = [
    `${result.action_label} (+${formatPts(result.action_points_awarded)} pts).`,
  ];

  const net = result.player_points_delta;
  parts.push(
    `Net for you: ${net >= 0 ? "+" : ""}${formatPts(net)} pts` +
      (result.opponent_points_delta !== 0
        ? ` · Opponent ${result.opponent_points_delta >= 0 ? "+" : ""}${formatPts(result.opponent_points_delta)} pts`
        : ""),
  );

  return parts.join(" ");
}

function formatPts(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
