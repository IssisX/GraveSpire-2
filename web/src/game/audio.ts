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
  ventGain: GainNode | null = null;
  ventFilter: BiquadFilterNode | null = null;
  ventSource: AudioBufferSourceNode | null = null;

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

  /**
   * One footfall, fired by the gait module at the bottom of a stride dip.
   * Audio follows the same phase as the camera, so the step you hear is the
   * step you feel.
   */
  foot(strength: number, left: boolean) {
    if (!this.ctx || !this.sfx || strength <= 0) return;
    const vol = 0.028 + 0.055 * Math.min(1, strength);
    this.beep((left ? 84 : 96) + Math.random() * 22, 0.045, vol);
    this.noise(0.055, vol * 0.5, 1400 + Math.random() * 500);
  }

  /** Landing thump. Severity is the real vertical speed at contact. */
  land(impact: number) {
    if (impact <= 0.6) return;
    const k = Math.min(1, impact / 8);
    this.beep(52 + Math.random() * 12, 0.16, 0.06 + k * 0.14);
    this.noise(0.12, 0.05 + k * 0.1, 320);
  }

  private noise(dur: number, vol: number, hp: number) {
    if (!this.ctx || !this.sfx) return;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hp;
    src.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    src.start();
    src.onended = () => {
      src.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }

  /** Continuous discharge bed while a vent valve is open. */
  setVent(open: boolean, pressureNorm: number) {
    if (!this.ctx || !this.amb) return;
    if (!this.ventGain) {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      const f = this.ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 2200;
      f.Q.value = 0.7;
      const len = Math.floor(this.ctx.sampleRate * 2);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(f);
      f.connect(g);
      g.connect(this.amb);
      src.start();
      this.ventGain = g;
      this.ventFilter = f;
      this.ventSource = src;
    }
    const t = this.ctx.currentTime;
    this.ventGain.gain.setTargetAtTime(open ? 0.05 + 0.13 * pressureNorm : 0, t, 0.15);
    this.ventFilter?.frequency.setTargetAtTime(1300 + 1800 * pressureNorm, t, 0.2);
  }

  setMasterVolume(v: number) {
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(Math.min(1, Math.max(0, v)), this.ctx.currentTime, 0.05);
  }

  resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  dispose() {
    try {
      this.ventSource?.stop();
    } catch {
      /* already stopped */
    }
    this.ventSource = null;
    this.ventGain = null;
    this.ventFilter = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
