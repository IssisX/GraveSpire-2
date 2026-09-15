export class GameAudio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfx: GainNode | null = null;
  amb: GainNode | null = null;
  motor: OscillatorNode | null = null;
  motorGain: GainNode | null = null;
  drone: OscillatorNode | null = null;
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
  }

  setMotor(load: number, on: boolean) {
    if (!this.ctx || !this.motor || !this.motorGain) return;
    const t = this.ctx.currentTime;
    this.motor.frequency.setTargetAtTime(28 + load * 90, t, 0.08);
    this.motorGain.gain.setTargetAtTime(on ? 0.04 + load * 0.08 : 0, t, 0.1);
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
