/** Who the workspace belongs to. One place to change it. */
export const NAME = 'Gabriel';

export type Band = 'night' | 'morning' | 'afternoon' | 'evening';

/** Which part of the day a local hour falls in. */
export function bandFor(hour: number): Band {
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  if (hour < 23) return 'evening';
  return 'night';
}

// `{name}` is filled in for the full greeting and dropped for the short one, so
// every line has to read on its own once the name comes off.
const BANDED: Record<Band, string[]> = {
  morning: [
    'Morning, {name}',
    'Good morning, {name}',
    'Early start, {name}?',
    'Coffee first, {name}?',
    'Fresh day, {name}',
    'Rise and grind, {name}',
    'What opens the day, {name}?',
    'First loop of the day, {name}?',
    'Clean slate, {name}',
    'Morning shift, {name}',
  ],
  afternoon: [
    'Afternoon, {name}',
    'Good afternoon, {name}',
    'Halfway there, {name}',
    'How is it going, {name}?',
    'Post-lunch push, {name}?',
    'Still moving, {name}?',
    'What is left today, {name}?',
    'Second wind, {name}?',
    'Afternoon stretch, {name}',
    'Making a dent, {name}?',
  ],
  evening: [
    'Evening, {name}',
    'Good evening, {name}',
    'Winding down, {name}?',
    'Still at it, {name}?',
    'One more before you stop, {name}?',
    'Closing anything tonight, {name}?',
    'Long day, {name}?',
    'Evening pass, {name}',
    'What can you put down, {name}?',
    'Last stretch, {name}',
  ],
  night: [
    'Late one, {name}?',
    'Still up, {name}?',
    'Burning the midnight oil, {name}?',
    'Night shift, {name}',
    'The quiet hours, {name}',
    'Should you be asleep, {name}?',
    'Nobody else is awake, {name}',
    'Small hours, {name}',
    'One last thing, {name}?',
    'Owl mode, {name}',
  ],
};

const ANYTIME = [
  'What is cooking, {name}?',
  'What is up next, {name}?',
  'Where were we, {name}?',
  'What is open, {name}?',
  'What is still running, {name}?',
  'What is half-done, {name}?',
  'What is the move, {name}?',
  'What needs you, {name}?',
  'What are we closing, {name}?',
  'Back at it, {name}',
  'Welcome back, {name}',
  'Good to see you, {name}',
  'Ready when you are, {name}',
  'Pick one, {name}',
  'One loop at a time, {name}',
  'Pick up where you left off, {name}',
  'Nothing forgotten, {name}',
  'Let us close something, {name}',
  'Anything you can finish, {name}?',
  'Loops are waiting, {name}',
  'The list remembers, {name}',
  'Shall we, {name}?',
  'Here we go, {name}',
  'What did you start, {name}?',
];

const fill = (t: string) => t.replace('{name}', NAME);
/** Drops the name — narrow headers have no room for it. */
const strip = (t: string) => t.replace(/,?\s*\{name\}/, '');

export interface Greeting {
  full: string;
  short: string;
}

/** How many characters the short form may run to, per layout. */
export const FITS = { full: Infinity, phone: 16, rail: 11 } as const;

/**
 * A greeting for this moment. `seed` picks which one, so it only changes when
 * the caller says so — a line that reshuffled while you were reading it would
 * be worse than no line at all.
 *
 * `maxLength` draws only from lines that still read whole in the space there is:
 * "Nobody else is awake" arriving as "Nobody e…" is worse than a plainer greeting.
 */
export function pickGreeting(now: number, seed: number, maxLength: number = FITS.full): Greeting {
  const all = [...BANDED[bandFor(new Date(now).getHours())], ...ANYTIME];
  const fitting = all.filter((t) => strip(t).length <= maxLength);
  const pool = fitting.length ? fitting : all;
  const t = pool[Math.abs(Math.trunc(seed)) % pool.length];
  return { full: fill(t), short: strip(t) };
}

/** Every line the workspace can open with, for tests and for counting. */
export function allGreetings(): string[] {
  return [...Object.values(BANDED).flat(), ...ANYTIME];
}
