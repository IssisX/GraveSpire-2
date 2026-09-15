import type { Act, WorldState } from "@/sim/types.ts";
import type { DialogueView } from "./store.ts";

type Node = {
  text: string;
  options: { id: string; label: string; act?: Act; next?: string }[];
};

const trees: Record<string, Record<string, (s: WorldState) => Node>> = {
  rami: {
    open: (s) => ({
      text: s.flags.payload_on_neck
        ? "That's a load on the neck. Brake is holding or it isn't — don't lie to me with a green light. Frame still looks ugly."
        : "Carrier 07-A is offset. You can feel it in the walk. Dock the live load on the neck deck. Brake is a real brake. If you dump it from height, that's on you.",
      options: [
        { id: "brake", label: "Tell me about the brake.", next: "brake" },
        { id: "neck", label: "What's wrong with the neck?", next: "neck" },
        { id: "bye", label: "I'll handle the load." },
      ],
    }),
    brake: () => ({
      text: "Fail-safe on this drum holds after power loss. Don't confuse that with 'power off means drop.' The other winch, over in 09, coasts. This one doesn't. Heat is friction. If it's cooking, you're slipping.",
      options: [{ id: "bye", label: "Understood." }],
    }),
    neck: () => ({
      text: "Transfer frame takes the carrier and the gate. Offset cargo twists it. Twist jams G-07. You want the walk, you unload, brace, or you go through Gallery 12 and live with what that does to occupied routes.",
      options: [{ id: "bye", label: "I'll read the frame." }],
    }),
  },
  ilea: {
    open: (s) => ({
      text: s.electrical.shop_powered
        ? "Shop's an island. Keep the gallery if people still need it. I don't care how pretty your recovered drive is if Skip cut the floor out from under a route."
        : "This shop is supposed to be the return. It has no power. Chen can feed us if you stop treating the drive cabinet like a holy object. Occupied routes stay occupied — I will not send anyone onto a sagging span.",
      options: [
        { id: "routes", label: "Occupied routes.", next: "routes" },
        { id: "power", label: "How do we stand the shop up?", next: "power" },
        { id: "bye", label: "I'll keep the walk." },
      ],
    }),
    routes: () => ({
      text: "Player judgment and mine are not the same world. You can try an unsafe deck. I will not. If you cut Gallery 12 down to one span, that is not a shortcut. That is a hole.",
      options: [{ id: "bye", label: "I hear you." }],
    }),
    power: () => ({
      text: "Live island. Not a flashlight. Close the shop breaker on a bus that actually has voltage. Chen's west reroute keeps us off the drive cabinet. That's the decent version of this job.",
      options: [{ id: "bye", label: "I'll find Chen." }],
    }),
  },
  chen: {
    open: (s) => ({
      text: s.electrical.chen_rerouted
        ? "West bus is in. Shop is no longer a parasite on the drive cabinet. Don't close gen and drive onto a fault just because you miss the old drawing."
        : "Process feed is cooking through the drive cabinet into hab. I will not parallel that. Isolate gen or open the cabinet, then I'll close west.",
      options: [
        ...(s.electrical.chen_rerouted
          ? []
          : [{ id: "reroute", label: "Make the west bus.", act: { type: "chen_reroute" as const }, next: "done" }]),
        { id: "iso", label: "Which breaker?", next: "iso" },
        { id: "bye", label: "I'll isolate first." },
      ],
    }),
    iso: () => ({
      text: "Generator output on the process board, or the drive cabinet itself. I stand at a board I can touch. I don't know a remote breaker's state because you looked at it.",
      options: [{ id: "bye", label: "I'll do it at the board." }],
    }),
    done: () => ({
      text: "West is closed. That's a different machine now. The drawing on the wall is a liar.",
      options: [{ id: "bye", label: "Shop first." }],
    }),
  },
  skip: {
    open: (s) => ({
      text: s.flags.drive_abandoned
        ? "It's gone. Rami will hate you. Ilea might still have a shop. That's the trade."
        : s.flags.drive_recovered
          ? "You did it the slow way. Fine. Don't ask me to clap."
          : "Drive's sitting on a bent transfer. We yank it, cut the neck feed, you're gone. Freight east of here becomes a story. Ilea's problem is power. Rami's problem is pride.",
      options: [
        ...(s.flags.drive_present
          ? [
              { id: "yank", label: "Do the fast pull.", act: { type: "abandon_drive" as const }, next: "yanked" },
              { id: "wait", label: "I'm recovering it intact.", next: "wait" },
            ]
          : []),
        { id: "gal", label: "This gallery.", next: "gal" },
        { id: "bye", label: "Not yet." },
      ],
    }),
    wait: () => ({
      text: "Then brace the neck, vent the gate, and unbolt it like a person. Don't drop a span on me while you roleplay engineer.",
      options: [{ id: "bye", label: "I won't." }],
    }),
    yanked: () => ({
      text: "Done. Drive is geometry. Neck feed is open. You want a clean conscience, talk to Ilea.",
      options: [{ id: "bye", label: "We're leaving a shop or we aren't." }],
    }),
    gal: () => ({
      text: "Five spans. Cut one, the others take it. Cut three, I stop walking. That's not a health bar. That's a floor.",
      options: [{ id: "bye", label: "I'll look at the members." }],
    }),
  },
};

export const DIALOGUE = trees;

export function talk(
  npcId: string,
  optionId: string,
  state: WorldState,
  commit?: (act: Act) => void,
): DialogueView | null {
  const tree = trees[npcId];
  if (!tree) return null;
  if (optionId === "bye") return null;

  const meta: Record<string, { name: string; role: string }> = {
    rami: { name: "Rami Okonkwo", role: "Crane lead" },
    ilea: { name: "Ilea Voss", role: "Steward" },
    chen: { name: "Chen Park", role: "Electrician" },
    skip: { name: "Skip Delgado", role: "Salvage" },
  };
  const who = meta[npcId]!;
  const format = (node: Node): DialogueView => ({
    npcId,
    name: who.name,
    role: who.role,
    text: node.text,
    options: node.options.map((o) => ({ id: o.id, label: o.label })),
  });

  if (optionId === "open") return format(tree.open(state));

  for (const key of Object.keys(tree)) {
    const node = tree[key]!(state);
    const opt = node.options.find((o) => o.id === optionId);
    if (!opt) continue;
    if (opt.act && commit) commit(opt.act);
    if (!opt.next || opt.next === "bye") return null;
    const nextMake = tree[opt.next];
    if (!nextMake) return null;
    return format(nextMake(state));
  }
  return format(tree.open(state));
}
