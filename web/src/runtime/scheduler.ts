// The shared transport clock.
//
// All time-driven control objects (metro, delay, pipe, clocker, line, …) register
// with this one scheduler instead of calling setInterval/setTimeout directly, so
// that (a) pressing ■ Stop halts every timer at once and ▶ Start resumes them, and
// (b) the control clock is the same clock the audio transport starts/stops with.
//
// An object "arms" a timer when it wants to run (e.g. metro switched on); the
// scheduler only lets armed timers actually fire while the transport is running.
//
// Timing is JS-timer accurate (~1ms jitter), not sample-accurate. Objects needing
// sample accuracy move their timing into an AudioWorklet instead (see runtime/worklet).

interface Timer {
  arm(): void; // begin firing (if transport running)
  disarm(): void; // stop firing (keeps registration)
}

class Scheduler {
  private running = false;
  private timers = new Set<Timer>();

  /** Whether the transport is currently running (▶ pressed). */
  get isRunning(): boolean {
    return this.running;
  }

  private add(make: (fire: () => void, done: () => void) => Timer, cb: () => void): () => void {
    let handle: ReturnType<typeof setInterval> | null = null;
    const timer: Timer = make(
      () => cb(),
      () => this.remove(timer)
    );
    this.timers.add(timer);
    if (this.running) timer.arm();
    void handle;
    return () => {
      timer.disarm();
      this.timers.delete(timer);
    };
  }

  private remove(t: Timer) {
    t.disarm();
    this.timers.delete(t);
  }

  /** Repeating callback every `ms`. Returns a canceller. Ticks only while running. */
  everyMs(ms: number, cb: () => void): () => void {
    let id: ReturnType<typeof setInterval> | null = null;
    return this.add(
      (fire) => ({
        arm() {
          if (id == null) id = setInterval(fire, Math.max(1, ms));
        },
        disarm() {
          if (id != null) {
            clearInterval(id);
            id = null;
          }
        },
      }),
      cb
    );
  }

  /** One-shot callback after `ms`. Returns a canceller. Fires only while running. */
  afterMs(ms: number, cb: () => void): () => void {
    let id: ReturnType<typeof setTimeout> | null = null;
    return this.add(
      (fire, done) => ({
        arm() {
          if (id == null)
            id = setTimeout(() => {
              id = null;
              done();
              fire();
            }, Math.max(0, ms));
        },
        disarm() {
          if (id != null) {
            clearTimeout(id);
            id = null;
          }
        },
      }),
      cb
    );
  }

  /** Transport ▶ : arm every registered timer. */
  start(): void {
    this.running = true;
    for (const t of this.timers) t.arm();
  }

  /** Transport ■ : disarm every registered timer (they resume on next start). */
  stop(): void {
    this.running = false;
    for (const t of this.timers) t.disarm();
  }

  /** Drop everything (patch reload). */
  clear(): void {
    for (const t of this.timers) t.disarm();
    this.timers.clear();
    this.running = false;
  }
}

/** Process-wide transport clock, shared by the engine and all timed objects. */
export const scheduler = new Scheduler();
