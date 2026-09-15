export class GameAudio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfx: GainNode | null = null;
  amb: GainNode | null = null;
  motor: OscillatorNode | null = null;
  motorGain: GainNode | null = null;
  drone: OscillatorNode | null = null;
  strainGain: GainNode | null = null;
  steamGain: GainNode | null = null;
  steamSrc: AudioBufferSourceNode | null = null;
  buzzGain: GainNode | null = null;
  gateGain: GainNode | null = null;
  brakeGain: GainNode | null = null;
  footT = 0;
  muted = false;

  unlock = () => {
    if (!this.ctx) {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new C({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.amb = this.ctx.createGain();
      this.sfx.gain.value = 0.5;
      this.amb.gain.value = 0.22;
      this.master.gain.value = 0.7;
      this.sfx.connect(this.master);
      this.amb.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.startBeds();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  };

  resume() {
    this.unlock();
  }

  private noiseLoop(vol: number, hp: number, lp: number): { gain: GainNode; src: AudioBufferSourceNode } | null {
    if (!this.ctx || !this.amb) return null;
    const n = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = n;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    const hi = this.ctx.createBiquadFilter();
    hi.type = "highpass";
    hi.frequency.value = hp;
    const lo = this.ctx.createBiquadFilter();
    lo.type = "lowpass";
    lo.frequency.value = lp;
    src.connect(hi);
    hi.connect(lo);
    lo.connect(g);
    g.connect(this.amb);
    src.start();
    return { gain: g, src };
  }

  private startBeds() {
    if (!this.ctx || !this.amb) return;
    const drone = this.ctx.createOscillator();
    drone.type = "sawtooth";
    drone.frequency.value = 42;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 180;
    const g = this.ctx.createGain();
    g.gain.value = 0.15;
    drone.connect(filt);
    filt.connect(g);
    g.connect(this.amb);
    drone.start();
    this.drone = drone;

    const motor = this.ctx.createOscillator();
    motor.type = "square";
    motor.frequency.value = 28;
    const mg = this.ctx.createGain();
    mg.gain.value = 0;
    const mf = this.ctx.createBiquadFilter();
    mf.type = "bandpass";
    mf.frequency.value = 220;
    motor.connect(mf);
    mf.connect(mg);
    mg.connect(this.amb);
    motor.start();
    this.motor = motor;
    this.motorGain = mg;

    const strain = this.noiseLoop(0, 40, 240);
    this.strainGain = strain?.gain ?? null;
    const steam = this.noiseLoop(0, 700, 2800);
    this.steamGain = steam?.gain ?? null;
    this.steamSrc = steam?.src ?? null;

    const buzz = this.ctx.createOscillator();
    buzz.type = "square";
    buzz.frequency.value = 60;
    const bg = this.ctx.createGain();
    bg.gain.value = 0;
    const bf = this.ctx.createBiquadFilter();
    bf.type = "bandpass";
    bf.frequency.value = 120;
    buzz.connect(bf);
    bf.connect(bg);
    bg.connect(this.amb);
    buzz.start();
    this.buzzGain = bg;

    const gate = this.ctx.createOscillator();
    gate.type = "sawtooth";
    gate.frequency.value = 18;
    const gg = this.ctx.createGain();
    gg.gain.value = 0;
    const gf = this.ctx.createBiquadFilter();
    gf.type = "lowpass";
    gf.frequency.value = 90;
    gate.connect(gf);
    gf.connect(gg);
    gg.connect(this.amb);
    gate.start();
    this.gateGain = gg;

    const brake = this.noiseLoop(0, 200, 900);
    this.brakeGain = brake?.gain ?? null;
  }

  setMotor(load: number, on: boolean) {
    if (!this.ctx || !this.motor || !this.motorGain) return;
    const t = this.ctx.currentTime;
    this.motor.frequency.setTargetAtTime(28 + load * 90, t, 0.08);
    this.motorGain.gain.setTargetAtTime(on ? 0.04 + load * 0.08 : 0, t, 0.1);
  }

  setStrain(amount: number) {
    if (!this.ctx || !this.strainGain) return;
    this.strainGain.gain.setTargetAtTime(amount > 0.18 ? 0.02 + amount * 0.05 : 0, this.ctx.currentTime, 0.25);
  }

  setSteam(amount: number) {
    if (!this.ctx || !this.steamGain) return;
    this.steamGain.gain.setTargetAtTime(amount * 0.045, this.ctx.currentTime, 0.2);
  }

  setBuzz(amount: number) {
    if (!this.ctx || !this.buzzGain) return;
    this.buzzGain.gain.setTargetAtTime(amount * 0.012, this.ctx.currentTime, 0.15);
  }

  setGate(amount: number) {
    if (!this.ctx || !this.gateGain) return;
    this.gateGain.gain.setTargetAtTime(amount * 0.06, this.ctx.currentTime, 0.08);
  }

  setBrake(amount: number) {
    if (!this.ctx || !this.brakeGain) return;
    this.brakeGain.gain.setTargetAtTime(amount * 0.03, this.ctx.currentTime, 0.12);
  }

  beep(freq: number, dur = 0.08, vol = 0.08) {
    if (!this.ctx || !this.sfx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "triangle";
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    o.connect(g);
    g.connect(this.sfx);
    o.start();
    o.stop(this.ctx.currentTime + dur + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  clank() {
    this.beep(140 + Math.random() * 40, 0.12, 0.12);
    this.beep(70, 0.18, 0.08);
  }

  hiss(vol = 0.06) {
    if (!this.ctx || !this.sfx) return;
    const n = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.4, this.ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource();
    src.buffer = n;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 800;
    src.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    src.start();
  }

  footstep(sprint: boolean) {
    const f = 78 + Math.random() * 28 + (sprint ? 18 : 0);
    this.beep(f, 0.045, sprint ? 0.07 : 0.048);
  }

  foot(dt: number, speed: number, grounded: boolean) {
    if (!grounded || speed < 0.8) {
      this.footT = 0;
      return;
    }
    this.footT += dt * speed;
    if (this.footT > 1.05) {
      this.footT = 0;
      this.footstep(speed > 3.6);
    }
  }

  setMaster(vol: number) {
    if (!this.master) return;
    this.master.gain.value = Math.max(0, Math.min(1, vol));
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
