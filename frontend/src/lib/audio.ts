/**
 * Browser-side SIMULATION of carrier-native call interventions.
 *
 * - Web Audio API: synthetic "line" bed (filtered noise + hum), ringtone, ducking ramps,
 *   whisper chime, flash-alert tone, and an analyser for the live waveform.
 * - Web Speech API: synthetic caller voice and the private security whisper.
 *
 * Nothing here touches a real phone call. Real carrier ducking/whisper happens in the
 * voice core (IMS/TAS media server); this engine only demonstrates the UX in a browser.
 * Every feature degrades gracefully: no AudioContext → silent visuals; no speechSynthesis → captions only.
 */

type Listener = (state: AudioState) => void;
export interface AudioState { supported: { webAudio: boolean; speech: boolean }; ducked: boolean; callerGain: number; speaking: boolean }

const DUCKED_GAIN = 0.25; // ≈ -12 dB

export class CarrierAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lineGain: GainNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private hum: OscillatorNode | null = null;
  private ring: { osc: OscillatorNode[]; gain: GainNode; timer: number } | null = null;
  analyser: AnalyserNode | null = null;
  private listeners = new Set<Listener>();
  private voices: SpeechSynthesisVoice[] = [];
  muted = false;
  state: AudioState = {
    supported: {
      webAudio: typeof window !== "undefined" && ("AudioContext" in window || "webkitAudioContext" in window),
      speech: typeof window !== "undefined" && "speechSynthesis" in window,
    },
    ducked: false,
    callerGain: 1,
    speaking: false,
  };

  constructor() {
    if (this.state.supported.speech) {
      const load = () => (this.voices = window.speechSynthesis.getVoices());
      load();
      window.speechSynthesis.addEventListener?.("voiceschanged", load);
    }
  }

  subscribe(fn: Listener) { this.listeners.add(fn); fn(this.state); return () => void this.listeners.delete(fn); }
  private emit(patch: Partial<AudioState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((l) => l(this.state)); }

  /** Must be called from a user gesture (autoplay policy). */
  async unlock() {
    if (!this.state.supported.webAudio) return;
    if (!this.ctx) {
      const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.master.connect(this.analyser).connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    if (muted && this.state.supported.speech) window.speechSynthesis.cancel();
  }

  startRinging() {
    if (!this.ctx || !this.master) return;
    this.stopRinging();
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    const osc = [440, 480].map((f) => {
      const o = this.ctx!.createOscillator();
      o.frequency.value = f;
      o.connect(gain);
      o.start();
      return o;
    });
    const pulse = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.07, t + 0.05);
      gain.gain.setValueAtTime(0.07, t + 1.4);
      gain.gain.linearRampToValueAtTime(0, t + 1.5);
    };
    pulse();
    const timer = window.setInterval(pulse, 3000);
    this.ring = { osc, gain, timer };
  }

  stopRinging() {
    if (!this.ring) return;
    clearInterval(this.ring.timer);
    this.ring.osc.forEach((o) => o.stop());
    this.ring.gain.disconnect();
    this.ring = null;
  }

  /** Synthetic line ambience that represents the caller's audio path (this is what gets ducked). */
  startLine() {
    if (!this.ctx || !this.master || this.noise) return;
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.2; }
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1200;
    band.Q.value = 0.6;
    this.lineGain = ctx.createGain();
    this.lineGain.gain.value = 0.16;
    this.hum = ctx.createOscillator();
    this.hum.frequency.value = 120;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.012;
    this.hum.connect(humGain).connect(this.lineGain);
    this.noise.connect(band).connect(this.lineGain).connect(this.master);
    this.noise.start();
    this.hum.start();
  }

  duck(on: boolean) {
    const target = on ? DUCKED_GAIN : 1;
    if (this.ctx && this.lineGain) this.lineGain.gain.setTargetAtTime(0.16 * target, this.ctx.currentTime, 0.18);
    this.emit({ ducked: on, callerGain: target });
  }

  private pickVoice(kind: "caller" | "whisper" | "subscriber") {
    const en = this.voices.filter((v) => v.lang?.startsWith("en"));
    const pref = {
      caller: ["Daniel", "Alex", "Fred", "Google UK English Male", "Microsoft David"],
      whisper: ["Samantha", "Karen", "Google US English", "Microsoft Zira", "Moira"],
      subscriber: ["Victoria", "Tessa", "Google UK English Female", "Microsoft Hazel"],
    }[kind];
    return pref.map((n) => en.find((v) => v.name.includes(n))).find(Boolean) ?? en[kind === "caller" ? 0 : 1] ?? en[0];
  }

  /** Speak a line. Resolves when finished (or immediately when speech is unavailable/muted). */
  speak(text: string, kind: "caller" | "whisper" | "subscriber", rate = 1.04): Promise<void> {
    if (!this.state.supported.speech || this.muted) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const v = this.pickVoice(kind);
      if (v) u.voice = v;
      u.rate = kind === "whisper" ? 0.98 : rate;
      u.pitch = kind === "caller" ? 0.85 : kind === "whisper" ? 1.08 : 1.1;
      u.volume = kind === "caller" ? this.state.callerGain : 1;
      const done = () => { this.emit({ speaking: false }); resolve(); };
      u.onend = done;
      u.onerror = done;
      this.emit({ speaking: true });
      window.speechSynthesis.speak(u);
      setTimeout(done, 400 + text.length * 95); // safety: some engines never fire onend
    });
  }

  chime() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    [880, 1318.5].forEach((f, i) => {
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.16);
      g.gain.linearRampToValueAtTime(0.12, t + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.5);
      o.connect(g).connect(this.master!);
      o.start(t + i * 0.16);
      o.stop(t + i * 0.16 + 0.55);
    });
  }

  alarm() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "triangle";
      o.frequency.value = 1046;
      g.gain.setValueAtTime(0.0001, t + i * 0.22);
      g.gain.linearRampToValueAtTime(0.1, t + i * 0.22 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.22 + 0.16);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.22);
      o.stop(t + i * 0.22 + 0.18);
    }
  }

  async whisper(text: string) {
    this.chime();
    await new Promise((r) => setTimeout(r, 420));
    if (this.state.supported.speech) window.speechSynthesis.cancel();
    await this.speak(text, "whisper");
  }

  /** 0..1 amplitude for visualisation (falls back to synthetic motion). */
  level(): number {
    if (!this.analyser) return 0;
    const buf = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    return peak / 128;
  }

  hangup() {
    this.stopRinging();
    if (this.state.supported.speech) window.speechSynthesis.cancel();
    try { this.noise?.stop(); this.hum?.stop(); } catch { /* already stopped */ }
    this.noise = null;
    this.hum = null;
    this.lineGain?.disconnect();
    this.lineGain = null;
    this.emit({ ducked: false, callerGain: 1, speaking: false });
  }
}

export const audioEngine = new CarrierAudioEngine();
