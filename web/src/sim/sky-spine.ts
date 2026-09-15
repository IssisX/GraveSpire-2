import { G, clamp, type LinkedCascadeState, type MechanicalDofState } from "./types.ts";
import { addGeneralizedForce, mechDof, type GeneralizedForces } from "./mechanical-network.ts";
import { MECH_ID } from "./mechanical-ids.ts";

/**
 * MC-11/12 continue the same shared generalized-coordinate authority.
 * MC-11 converts exposed high-altitude wind load into hoist work; MC-12 uses
 * the arriving sky-car to release a building-scale gravity pendulum whose
 * impact physically drives the next traversable bridge.
 */
export const SKY = {
  z: -36.0,

  // MC-11 — Windward Hoist.
  baseY: 91.0,
  windLatchTravelM: 0.24,
  windLatchClearM: 0.10,
  windLatchBridgeStartM: 13.8,
  windLatchGain: 0.36,
  windLatchK: 1.0e5,
  windLatchC: 7.0e3,
  sailPivotX: 250.0,
  sailPivotY: 103.0,
  sailAreaM2: 420.0,
  sailArmM: 8.0,
  sailInertiaKgm2: 8.5e6,
  sailDampingNms: 8.0e4,
  sailMaxRad: 5.4,
  drumRadiusM: 2.0,
  airDensityKgM3: 1.18,
  prevailingWindMps: 14.0,
  skyCarX: 258.0,
  skyCarBaseY: 103.0,
  skyCarTravelM: 24.0,
  skyCarMassKg: 38000.0,
  counterweightMassKg: 28000.0,
  counterweightX: 265.0,
  cableK: 1.4e6,
  cableC: 9.0e4,

  // MC-12 — Pendulum Crown.
  pendulumLatchTravelM: 0.30,
  pendulumLatchClearM: 0.11,
  pendulumTripQ: 22.6,
  pendulumLatchGain: 0.42,
  pendulumLatchK: 1.2e5,
  pendulumLatchC: 9.0e3,
  pendulumPivotX: 276.0,
  pendulumPivotY: 132.0,
  pendulumLengthM: 18.0,
  pendulumMassKg: 70000.0,
  pendulumInitialRad: -0.96,
  pendulumMaxRad: 1.08,
  pendulumDampingNms: 2.0e5,
  pendulumBallastKg: 18000.0,
  pendulumBallastRadiusM: 9.5,
  bridgeX: 288.0,
  bridgeY: 132.0,
  bridgeMassKg: 26000.0,
  bridgeTravelM: 20.0,
  bridgeContactStartX: 286.0,
  bridgeContactK: 6.0e5,
  bridgeContactC: 6.0e4,
} as const;

function addDof(chain: LinkedCascadeState, d: MechanicalDofState): void {
  if (!chain.network.dofs.some((x) => x.id === d.id)) chain.network.dofs.push(d);
}

export function ensureSkySpineState(chain: LinkedCascadeState): void {
  addDof(chain, {
    id: MECH_ID.mc11WindLatch,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: 48,
    damping_si: 420,
    min_q: 0,
    max_q: SKY.windLatchTravelM,
    stop_restitution: 0,
  });
  addDof(chain, {
    id: MECH_ID.mc11Sail,
    kind: "rotary",
    q: 0,
    v: 0,
    inertia_si: SKY.sailInertiaKgm2,
    damping_si: SKY.sailDampingNms,
    min_q: 0,
    max_q: SKY.sailMaxRad,
    stop_restitution: 0.02,
  });
  addDof(chain, {
    id: MECH_ID.mc11SkyCar,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: SKY.skyCarMassKg,
    damping_si: 4200,
    min_q: 0,
    max_q: SKY.skyCarTravelM,
    stop_restitution: 0.02,
  });
  addDof(chain, {
    id: MECH_ID.mc11Counterweight,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: SKY.counterweightMassKg,
    damping_si: 3200,
    min_q: 0,
    max_q: SKY.skyCarTravelM,
    stop_restitution: 0.02,
  });
  addDof(chain, {
    id: MECH_ID.mc12PendulumLatch,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: 52,
    damping_si: 460,
    min_q: 0,
    max_q: SKY.pendulumLatchTravelM,
    stop_restitution: 0,
  });
  addDof(chain, {
    id: MECH_ID.mc12Pendulum,
    kind: "rotary",
    q: SKY.pendulumInitialRad,
    v: 0,
    inertia_si:
      SKY.pendulumMassKg * SKY.pendulumLengthM * SKY.pendulumLengthM +
      SKY.pendulumBallastKg * SKY.pendulumBallastRadiusM * SKY.pendulumBallastRadiusM,
    damping_si: SKY.pendulumDampingNms,
    min_q: SKY.pendulumInitialRad,
    max_q: SKY.pendulumMaxRad,
    stop_restitution: 0.03,
  });
  addDof(chain, {
    id: MECH_ID.mc12Ballast,
    kind: "linear",
    q: SKY.pendulumBallastRadiusM,
    v: 0,
    inertia_si: SKY.pendulumBallastKg,
    damping_si: 1.0e4,
    min_q: 5.5,
    max_q: 14.0,
    stop_restitution: 0.04,
  });
  addDof(chain, {
    id: MECH_ID.mc12LandingBridge,
    kind: "linear",
    q: 0,
    v: 0,
    inertia_si: SKY.bridgeMassKg,
    damping_si: 2.5e4,
    min_q: 0,
    max_q: SKY.bridgeTravelM,
    stop_restitution: 0.02,
  });

  if (!chain.network.cables.some((c) => c.id === MECH_ID.mc11HoistCable)) {
    const supportTension = 0.5 * (SKY.skyCarMassKg + SKY.counterweightMassKg) * G;
    const base = 48.0;
    chain.network.cables.push({
      id: MECH_ID.mc11HoistCable,
      base_length_m: base,
      rest_length_m: base - supportTension / SKY.cableK,
      length_m: base,
      stiffness_npm: SKY.cableK,
      damping_ns_pm: SKY.cableC,
      tension_n: supportTension,
      slack: false,
      terms: [
        { dof_id: MECH_ID.mc11Sail, gradient_m_per_q: SKY.drumRadiusM },
        { dof_id: MECH_ID.mc11SkyCar, gradient_m_per_q: -1 },
        { dof_id: MECH_ID.mc11Counterweight, gradient_m_per_q: 1 },
      ],
    });
  }
}

/** Simplified deterministic prevailing-wind load; not CFD. */
export function highAltitudeWindMps(heightM: number): number {
  const exposure = clamp((heightM - 78) / 65, 0, 1);
  return SKY.prevailingWindMps * (0.58 + 0.42 * exposure);
}

export function applySkySpineForces(chain: LinkedCascadeState, forces: GeneralizedForces): void {
  ensureSkySpineState(chain);
  const net = chain.network;
  const mc10Bridge = mechDof(net, MECH_ID.mc10Bridge);
  const latch = mechDof(net, MECH_ID.mc11WindLatch);
  const sail = mechDof(net, MECH_ID.mc11Sail);
  const car = mechDof(net, MECH_ID.mc11SkyCar);
  const counter = mechDof(net, MECH_ID.mc11Counterweight);
  const pendulumLatch = mechDof(net, MECH_ID.mc12PendulumLatch);
  const pendulum = mechDof(net, MECH_ID.mc12Pendulum);
  const ballast = mechDof(net, MECH_ID.mc12Ballast);
  const bridge = mechDof(net, MECH_ID.mc12LandingBridge);

  // MC-10 bridge physically opens MC-11's sail brake/latch.
  const latchTarget = clamp(
    (mc10Bridge.q - SKY.windLatchBridgeStartM) * SKY.windLatchGain,
    0,
    SKY.windLatchTravelM,
  );
  const latchTargetV = mc10Bridge.q > SKY.windLatchBridgeStartM ? mc10Bridge.v * SKY.windLatchGain : 0;
  const latchForce = SKY.windLatchK * (latchTarget - latch.q) + SKY.windLatchC * (latchTargetV - latch.v);
  addGeneralizedForce(forces, MECH_ID.mc11WindLatch, latchForce);
  if (latchForce > 0) addGeneralizedForce(forces, MECH_ID.mc10Bridge, -latchForce * SKY.windLatchGain);
  const latchDetentTarget = latch.q > SKY.windLatchClearM * 0.72 ? SKY.windLatchTravelM : 0;
  addGeneralizedForce(forces, MECH_ID.mc11WindLatch, 2.8e4 * (latchDetentTarget - latch.q));

  // Wind pressure acts on a real giant sail/drum. Cable tension reacts on the same rotary DOF.
  const wind = highAltitudeWindMps(SKY.sailPivotY);
  const qDyn = 0.5 * SKY.airDensityKgM3 * wind * wind;
  const windTorque = qDyn * SKY.sailAreaM2 * SKY.sailArmM * Math.max(0.08, Math.cos(sail.q * 0.34));
  addGeneralizedForce(forces, MECH_ID.mc11Sail, windTorque);
  addGeneralizedForce(forces, MECH_ID.mc11SkyCar, -SKY.skyCarMassKg * G);
  addGeneralizedForce(forces, MECH_ID.mc11Counterweight, SKY.counterweightMassKg * G);

  // Arriving sky-car strokes MC-12 latch. Equal/opposite reaction loads the car.
  const pTarget = clamp(
    (car.q - SKY.pendulumTripQ) * SKY.pendulumLatchGain,
    0,
    SKY.pendulumLatchTravelM,
  );
  const pTargetV = car.q > SKY.pendulumTripQ ? car.v * SKY.pendulumLatchGain : 0;
  const pLatchForce = SKY.pendulumLatchK * (pTarget - pendulumLatch.q) + SKY.pendulumLatchC * (pTargetV - pendulumLatch.v);
  addGeneralizedForce(forces, MECH_ID.mc12PendulumLatch, pLatchForce);
  if (pLatchForce > 0) addGeneralizedForce(forces, MECH_ID.mc11SkyCar, -pLatchForce * SKY.pendulumLatchGain);
  const pDetentTarget = pendulumLatch.q > SKY.pendulumLatchClearM * 0.72 ? SKY.pendulumLatchTravelM : 0;
  addGeneralizedForce(forces, MECH_ID.mc12PendulumLatch, 3.4e4 * (pDetentTarget - pendulumLatch.q));

  // Gravity pendulum with movable ballast changing inertia and moment.
  pendulum.inertia_si =
    SKY.pendulumMassKg * SKY.pendulumLengthM * SKY.pendulumLengthM +
    SKY.pendulumBallastKg * ballast.q * ballast.q;
  const gravityTorque =
    -SKY.pendulumMassKg * G * SKY.pendulumLengthM * Math.sin(pendulum.q) -
    SKY.pendulumBallastKg * G * ballast.q * Math.sin(pendulum.q);
  addGeneralizedForce(forces, MECH_ID.mc12Pendulum, gravityTorque);

  // The pendulum nose physically rams the bridge carriage during its forward swing.
  const tipX = SKY.pendulumPivotX + SKY.pendulumLengthM * Math.sin(pendulum.q);
  const tipVx = SKY.pendulumLengthM * Math.cos(pendulum.q) * pendulum.v;
  const bridgeFace = SKY.bridgeContactStartX + bridge.q;
  const penetration = Math.max(0, tipX - bridgeFace);
  if (penetration > 0) {
    const closing = tipVx - bridge.v;
    const reaction = Math.max(0, SKY.bridgeContactK * penetration + SKY.bridgeContactC * Math.max(0, closing));
    addGeneralizedForce(forces, MECH_ID.mc12LandingBridge, reaction);
    addGeneralizedForce(forces, MECH_ID.mc12Pendulum, -reaction * SKY.pendulumLengthM * Math.cos(pendulum.q));
  }
}

export function enforceSkySpineConstraints(chain: LinkedCascadeState): void {
  ensureSkySpineState(chain);
  const windLatch = mechDof(chain.network, MECH_ID.mc11WindLatch);
  const sail = mechDof(chain.network, MECH_ID.mc11Sail);
  if (windLatch.q < SKY.windLatchClearM && sail.q > 0) {
    sail.q = 0;
    if (sail.v > 0) sail.v = 0;
  }

  const pendulumLatch = mechDof(chain.network, MECH_ID.mc12PendulumLatch);
  const pendulum = mechDof(chain.network, MECH_ID.mc12Pendulum);
  if (pendulumLatch.q < SKY.pendulumLatchClearM && pendulum.q > SKY.pendulumInitialRad) {
    pendulum.q = SKY.pendulumInitialRad;
    if (pendulum.v > 0) pendulum.v = 0;
  }
}

export function skySpineFinite(chain: LinkedCascadeState): boolean {
  ensureSkySpineState(chain);
  const ids = [
    MECH_ID.mc11WindLatch,
    MECH_ID.mc11Sail,
    MECH_ID.mc11SkyCar,
    MECH_ID.mc11Counterweight,
    MECH_ID.mc12PendulumLatch,
    MECH_ID.mc12Pendulum,
    MECH_ID.mc12Ballast,
    MECH_ID.mc12LandingBridge,
  ];
  return ids.every((id) => {
    const d = mechDof(chain.network, id);
    return Number.isFinite(d.q) && Number.isFinite(d.v) && Number.isFinite(d.inertia_si);
  });
}

export function mc11World(chain: LinkedCascadeState) {
  ensureSkySpineState(chain);
  const sail = mechDof(chain.network, MECH_ID.mc11Sail);
  const car = mechDof(chain.network, MECH_ID.mc11SkyCar);
  const counter = mechDof(chain.network, MECH_ID.mc11Counterweight);
  return {
    sail: { x: SKY.sailPivotX, y: SKY.sailPivotY, z: SKY.z, angle: sail.q, omega: sail.v },
    car: { x: SKY.skyCarX, y: SKY.skyCarBaseY + car.q, z: SKY.z, vy: car.v },
    counterweight: { x: SKY.counterweightX, y: SKY.skyCarBaseY + SKY.skyCarTravelM - counter.q, z: SKY.z, vy: -counter.v },
    windMps: highAltitudeWindMps(SKY.skyCarBaseY + car.q),
  };
}

export function mc12World(chain: LinkedCascadeState) {
  ensureSkySpineState(chain);
  const pendulum = mechDof(chain.network, MECH_ID.mc12Pendulum);
  const ballast = mechDof(chain.network, MECH_ID.mc12Ballast);
  const bridge = mechDof(chain.network, MECH_ID.mc12LandingBridge);
  return {
    pendulum: { x: SKY.pendulumPivotX, y: SKY.pendulumPivotY, z: SKY.z, angle: pendulum.q, omega: pendulum.v },
    ballastRadius: ballast.q,
    bridge: { x: SKY.bridgeX + bridge.q, y: SKY.bridgeY, z: SKY.z, q: bridge.q, vx: bridge.v },
  };
}
