import { describe, expect, it } from 'vitest';
import { activeNote, cleanNote, makeNote, moveNote, normalizeNotes, notesFromNote, openNotes } from '../../shared/notes';
import { NOTES_MAX, NOTE_MAX, type NoteItem } from '../../shared/types';

const list = (...spec: [string, boolean][]): NoteItem[] => spec.map(([text, done]) => ({ ...makeNote(text), done }));

describe('cleanNote', () => {
  it('collapses a note onto one line and caps it', () => {
    expect(cleanNote('  ship \n the  deck ')).toBe('ship the deck');
    expect(cleanNote('x'.repeat(NOTE_MAX + 40))).toHaveLength(NOTE_MAX);
  });
});

describe('activeNote', () => {
  it('reads the first unchecked line, in the arranged order', () => {
    expect(activeNote(list(['call the supplier', false], ['send the deck', false]))).toBe('call the supplier');
  });

  it('skips checked lines without resorting them', () => {
    const notes = list(['call the supplier', true], ['send the deck', false]);
    expect(activeNote(notes)).toBe('send the deck');
    expect(notes[0].text).toBe('call the supplier');
  });

  it('goes quiet when everything is checked off', () => {
    expect(activeNote(list(['done', true]))).toBe('');
    expect(activeNote([])).toBe('');
    expect(openNotes(list(['a', true], ['b', false], ['c', false]))).toBe(2);
  });
});

describe('moveNote', () => {
  const notes = list(['a', false], ['b', false], ['c', false]);
  const texts = (n: NoteItem[]) => n.map((x) => x.text).join('');

  it('moves a line to a new place, which is how the ticker line is chosen', () => {
    expect(texts(moveNote(notes, 2, 0))).toBe('cab');
    expect(activeNote(moveNote(notes, 2, 0))).toBe('c');
    expect(texts(moveNote(notes, 0, 1))).toBe('bac');
  });

  it('clamps past the ends and leaves a no-op list alone', () => {
    expect(texts(moveNote(notes, 0, -3))).toBe('abc');
    expect(texts(moveNote(notes, 0, 9))).toBe('bca');
    expect(moveNote(notes, 1, 1)).toBe(notes);
    expect(moveNote(notes, 7, 0)).toBe(notes);
  });
});

describe('normalizeNotes', () => {
  it('drops blanks, cleans text and keeps ids unique', () => {
    const out = normalizeNotes([
      { id: 'a', text: '  first  line ', done: false },
      { id: 'a', text: 'second', done: true },
      { id: 'b', text: '   ', done: false },
      'nonsense',
      null,
    ]);
    expect(out.map((n) => n.text)).toEqual(['first line', 'second']);
    expect(out[0].id).not.toBe(out[1].id);
    expect(out[1].done).toBe(true);
  });

  it('caps the list and survives anything that is not a list', () => {
    const many = Array.from({ length: NOTES_MAX + 5 }, (_, i) => ({ id: `n${i}`, text: `note ${i}`, done: false }));
    expect(normalizeNotes(many)).toHaveLength(NOTES_MAX);
    expect(normalizeNotes(undefined)).toEqual([]);
  });
});

describe('notesFromNote', () => {
  it('turns one legacy note into a one-line checklist', () => {
    expect(notesFromNote('context').map((n) => ({ text: n.text, done: n.done }))).toEqual([{ text: 'context', done: false }]);
    expect(notesFromNote('   ')).toEqual([]);
  });
});
