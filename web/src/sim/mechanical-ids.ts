export const MECH_ID = {
  mc01Lever: "mc01_lever",
  mc01Ballast: "mc01_ballast",
  mc01Lift: "mc01_lift",
  mc01Rope: "mc01_rope",
  entryRocker: "entry_rocker",
  entryPawl: "entry_pawl",
  entryPawlCable: "entry_pawl_cable",
  transferCarriage: "transfer_carriage",
  transferCounterweight: "transfer_counterweight",
  transferRope: "transfer_rope",
  bridgeRelease: "bridge_release",
  bridgePawl: "bridge_pawl",
  bridgePawlCable: "bridge_pawl_cable",
  bridge: "bridge",
  springShuttleLatch: "spring_shuttle_latch",
  springShuttle: "spring_shuttle",
} as const;

export type MechanicalId = (typeof MECH_ID)[keyof typeof MECH_ID];
