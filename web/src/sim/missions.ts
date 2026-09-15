import type { ObjectiveStatus, TraversalEdge, WorldState } from "./types.ts";

export function gallerySag(state: WorldState): number {
  const live = state.members.filter((m) => m.role === "gallery_span" && !m.cut);
  if (live.length === 0) return 0.45;
  return live.reduce((a, m) => Math.max(a, m.sag_m), 0);
}

export function liveGalleryCount(state: WorldState): number {
  return state.members.filter((m) => m.role === "gallery_span" && !m.cut).length;
}

export function neckWalkClear(state: WorldState): boolean {
  return (
    Math.abs(state.gate.seal_misalignment_m) < 0.032 ||
    state.frame.brace_connected ||
    Boolean(state.members.find((m) => m.id === "neck_brace" && m.jacked))
  );
}

export function gatePassable(state: WorldState): boolean {
  return state.gate.angle_rad > 0.95;
}

export function inhabitantCanReachShop(state: WorldState): boolean {
  const galleryOk = liveGalleryCount(state) >= 2 && gallerySag(state) < 0.08;
  const mainOk = gatePassable(state) && neckWalkClear(state);
  return galleryOk || mainOk;
}

export function shopStanding(state: WorldState): boolean {
  return state.electrical.shop_powered && state.flags.save_used && inhabitantCanReachShop(state);
}

export function evaluateTraversal(state: WorldState): TraversalEdge[] {
  const sag = gallerySag(state);
  const live = liveGalleryCount(state);
  const galleryValid = live >= 2 && sag < 0.14;
  const galleryNpc = live >= 3 && sag < 0.08;
  const gateOpen = gatePassable(state);
  const neck = neckWalkClear(state);

  return [
    {
      id: "bay_floor",
      from: "fs07_floor",
      to: "fs07_floor",
      kind: "walk",
      valid: true,
      npc_safe: true,
      reason: null,
    },
    {
      id: "bay_catwalk",
      from: "fs07_catwalk",
      to: "fs07_floor",
      kind: "stairs",
      valid: true,
      npc_safe: true,
      reason: null,
    },
    {
      id: "bay_to_neck_gate",
      from: "fs07_floor",
      to: "fs08_floor",
      kind: "walk",
      valid: gateOpen,
      npc_safe: gateOpen && state.gate.pressure_pa < 80000,
      reason: gateOpen ? null : "Isolation gate closed or jammed",
    },
    {
      id: "neck_main",
      from: "fs08_floor",
      to: "fs08_drive",
      kind: "walk",
      valid: neck,
      npc_safe: neck && Math.abs(state.gate.seal_misalignment_m) < 0.02,
      reason: neck ? null : "Transfer deck misaligned — brace, jack, or unload",
    },
    {
      id: "neck_to_shop",
      from: "fs08_floor",
      to: "sha_shop",
      kind: "walk",
      valid: neck && (gateOpen || galleryValid),
      npc_safe: neck && state.electrical.shop_powered,
      reason: neck ? null : "Neck walk not clear",
    },
    {
      id: "bay_to_gallery",
      from: "fs07_catwalk",
      to: "lt12_floor",
      kind: "stairs",
      valid: true,
      npc_safe: true,
      reason: null,
    },
    {
      id: "gallery_span",
      from: "lt12_west",
      to: "lt12_east",
      kind: "walk",
      valid: galleryValid,
      npc_safe: galleryNpc,
      reason: galleryValid
        ? galleryNpc
          ? null
          : "Deck sag exceeds occupied-route estimate"
        : "Gallery load path failed — not enough live spans",
    },
    {
      id: "gallery_to_neck",
      from: "lt12_east",
      to: "fs08_floor",
      kind: "walk",
      valid: galleryValid,
      npc_safe: galleryNpc,
      reason: galleryValid ? null : "Gallery cannot carry the connection",
    },
    {
      id: "gallery_to_shop",
      from: "lt12_east",
      to: "sha_shop",
      kind: "walk",
      valid: galleryValid,
      npc_safe: galleryNpc,
      reason: galleryValid ? null : "Back route is not a floor anymore",
    },
  ];
}

export function evaluateMissions(state: WorldState): ObjectiveStatus[] {
  const docked =
    state.flags.payload_on_neck &&
    state.freight.brake_engaged &&
    Math.abs(state.gate.seal_misalignment_m) < 0.05;
  const walk = evaluateTraversal(state);
  const maint = walk.some(
    (e) =>
      (e.id === "gallery_span" || e.id === "neck_main") &&
      e.valid &&
      (e.id === "neck_main" ? e.valid : e.valid),
  );
  const maintOpen =
    (walk.find((e) => e.id === "neck_main")?.valid ?? false) ||
    (walk.find((e) => e.id === "gallery_span")?.valid &&
      (walk.find((e) => e.id === "gallery_to_neck")?.valid ?? false));
  const shop = shopStanding(state);
  const drive = state.flags.drive_recovered || state.flags.drive_abandoned;

  return [
    {
      id: "dock",
      title: "Dock a live load",
      done: docked,
      note: docked
        ? "Payload is on the neck deck. Brake is holding."
        : "Carrier payload on the neck deck, brake real, alignment inside tolerance.",
    },
    {
      id: "walk",
      title: "Open a maintenance walk",
      done: Boolean(maintOpen),
      note: maintOpen
        ? maint
          ? "A live walk exists by load path — not by deleting a wall."
          : "Walk is open."
        : "Change support or load. Gate, brace, jack, or Gallery 12.",
    },
    {
      id: "shop",
      title: "Stand up Circ Shop",
      done: shop,
      note: shop
        ? "Shop is a live island. Save is real. Someone can reach it."
        : "Power from a live island, use the bench, keep an inhabitant route.",
    },
    {
      id: "drive",
      title: "The drive",
      done: drive,
      note: state.flags.drive_recovered
        ? "Drive recovered. Freight capacity and hab feed have changed."
        : state.flags.drive_abandoned
          ? "Drive abandoned. Neck transfer is no longer a machine."
          : "Recover a functioning drive or explicitly abandon it. Both are endings.",
    },
  ];
}

export function endingCopy(state: WorldState): {
  title: string;
  body: string;
  freight: string;
  power: string;
  people: string;
} {
  const recovered = state.flags.drive_recovered;
  const shop = state.electrical.shop_powered;
  const walk = inhabitantCanReachShop(state);
  return {
    title: recovered ? "Drive recovered" : "Drive abandoned",
    body: recovered
      ? "You took the functioning drive off a distorted transfer. The building kept the part and lost some of what the part was doing."
      : "You accepted Skip's pull. The neck is no longer a machine you can count on. The shop may still be a place to work — if it has power.",
    freight: recovered
      ? state.frame.brace_connected
        ? "Carrier still docks. Neck alignment is braced, not restored."
        : "Carrier docks. Neck self-align is gone with the drive."
      : "Neck transfer is dead. Bay 07 can still lift. It cannot hand the load east.",
    power: shop
      ? state.electrical.chen_rerouted
        ? "Circ Shop runs on Chen's west bus. Process and hab are no longer the same island."
        : "Shop is lit from the remaining island."
      : "Hab Band A is dark. Ilea's occupied routes have no shop.",
    people: walk
      ? "Someone can still walk to the shop. They will remember how you opened that walk."
      : "The shop is isolated from the people who needed it. Rescue is now a different job.",
  };
}
