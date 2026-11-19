// The Live parameter block: where a live.* object keeps its range, unit and start value.
//
// None of it is in the box text. Max saves it on the box under
// `saved_attribute_attributes.valueof`, and both the dial widget and any page that
// wants to label a parameter the way Ableton would read it from there.

export interface LiveParam {
  longname: string;
  shortname: string;
  min: number;
  max: number;
  /** The value the device loads with, when the box enables one. */
  initial: number;
  /** Position-to-value curve: value = min + (max - min) * position ^ exponent. */
  exponent: number;
  /** Live's parameter_unitstyle: 0 int, 1 float, 2 ms, 3 Hz, 4 dB, 5 %. */
  unitstyle: number;
  integer: boolean;
}

const firstOf = (v: unknown): number | undefined => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : undefined;
};

/** Read a box's parameter block, with Max's defaults for a float parameter (0..127). */
export function liveParam(raw: Record<string, unknown> | undefined, fallbackName = ''): LiveParam {
  const saved = raw?.saved_attribute_attributes as { valueof?: Record<string, unknown> } | undefined;
  const p = saved?.valueof ?? {};
  const min = firstOf(p.parameter_mmin) ?? 0;
  const max = firstOf(p.parameter_mmax) ?? 127;
  const integer = Number(p.parameter_type) === 1;
  const initial = Number(p.parameter_initial_enable) === 1 ? firstOf(p.parameter_initial) ?? min : min;
  const longname = typeof p.parameter_longname === 'string' ? p.parameter_longname : fallbackName;
  return {
    longname,
    shortname: typeof p.parameter_shortname === 'string' ? p.parameter_shortname : longname,
    min,
    max,
    initial: Math.min(Math.max(initial, Math.min(min, max)), Math.max(min, max)),
    exponent: Math.max(0.01, firstOf(p.parameter_exponent) ?? 1),
    unitstyle: firstOf(p.parameter_unitstyle) ?? (integer ? 0 : 1),
    integer,
  };
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Knob position (0..1) to parameter value. */
export function paramValue(p: LiveParam, position: number): number {
  const v = p.min + (p.max - p.min) * clamp01(position) ** p.exponent;
  return p.integer ? Math.round(v) : v;
}

/** Parameter value to knob position (0..1). */
export function paramPosition(p: LiveParam, value: number): number {
  if (p.max === p.min) return 0;
  return clamp01((value - p.min) / (p.max - p.min)) ** (1 / p.exponent);
}

const trim = (n: number, digits: number): string => {
  const s = n.toFixed(digits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
};

/** A value as Ableton would print it under the dial. */
export function formatParam(p: LiveParam, value: number): string {
  switch (p.unitstyle) {
    case 0:
      return String(Math.round(value));
    case 2:
      return value >= 1000 ? `${trim(value / 1000, 2)} s` : `${trim(value, value < 10 ? 1 : 0)} ms`;
    case 3:
      return value >= 1000 ? `${trim(value / 1000, 2)} kHz` : `${trim(value, value < 10 ? 2 : 0)} Hz`;
    case 4:
      return `${value > 0 ? '+' : ''}${trim(value, 1)} dB`;
    case 5:
      return `${trim(value, 0)} %`;
    default:
      return trim(value, Math.abs(value) >= 100 ? 0 : 2);
  }
}
