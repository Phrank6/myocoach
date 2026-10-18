export type InputAction = 'toggleSet' | 'nextExercise' | 'prevExercise' | 'intensityUp' | 'intensityDown' | 'finish' | 'toggleAuto';

export interface InputState {
  /** Effort 0..1 from analog trigger/stick, or null if only digital input is active. */
  analogEffort: number | null;
  /** Digital "push" held (space / A-face button). */
  pushHeld: boolean;
  actions: InputAction[];
  gamepadName: string | null;
}

const KEY_ACTIONS: Record<string, InputAction> = {
  Enter: 'toggleSet',
  ArrowRight: 'nextExercise',
  KeyE: 'nextExercise',
  ArrowLeft: 'prevExercise',
  KeyQ: 'prevExercise',
  ArrowUp: 'intensityUp',
  Equal: 'intensityUp',
  ArrowDown: 'intensityDown',
  Minus: 'intensityDown',
  KeyF: 'finish',
  KeyA: 'toggleAuto',
};

// Standard-mapping gamepad buttons
const PAD_ACTIONS: [number, InputAction][] = [
  [0, 'toggleSet'], // A / Cross
  [5, 'nextExercise'], // RB
  [15, 'nextExercise'], // D-pad right
  [4, 'prevExercise'], // LB
  [14, 'prevExercise'], // D-pad left
  [12, 'intensityUp'], // D-pad up
  [13, 'intensityDown'], // D-pad down
  [9, 'finish'], // Start
  [3, 'toggleAuto'], // Y / Triangle
];

/** Polls the Gamepad API each frame and merges it with keyboard input. */
export class InputController {
  private keysDown = new Set<string>();
  private queued: InputAction[] = [];
  private prevPad = new Map<number, boolean>();
  enabled = true;

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    if (!this.enabled) return;
    if (e.code === 'Space' || KEY_ACTIONS[e.code]) e.preventDefault();
    if (e.repeat) return;
    this.keysDown.add(e.code);
    const a = KEY_ACTIONS[e.code];
    if (a) this.queued.push(a);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keysDown.delete(e.code);
  };
  private onBlur = () => this.keysDown.clear();

  attach() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  poll(): InputState {
    const actions = this.queued;
    this.queued = [];
    let analog: number | null = null;
    let padPush = false;
    let gamepadName: string | null = null;

    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = Array.from(pads ?? []).find((p) => p && p.connected) ?? null;
    if (pad) {
      gamepadName = pad.id || 'Gamepad';
      const rt = pad.buttons[7]?.value ?? 0;
      const stickUp = Math.max(0, -(pad.axes[3] ?? 0), -(pad.axes[1] ?? 0));
      const v = Math.max(rt, stickUp > 0.15 ? stickUp : 0);
      if (v > 0.02) analog = Math.min(1, v);
      padPush = !!pad.buttons[6]?.pressed; // LT as digital push
      if (this.enabled) {
        for (const [idx, action] of PAD_ACTIONS) {
          const pressed = !!pad.buttons[idx]?.pressed;
          if (pressed && !this.prevPad.get(idx)) actions.push(action);
          this.prevPad.set(idx, pressed);
        }
      }
    }

    return {
      analogEffort: analog,
      pushHeld: this.enabled && (this.keysDown.has('Space') || padPush),
      actions: this.enabled ? actions : [],
      gamepadName,
    };
  }
}
