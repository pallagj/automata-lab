/**
 * A note is a cell whose source starts with # (it is not evaluated). It is stored with "# " before every
 * line but edited and shown as plain text, as in Desmos: the markers are added and stripped here.
 */

const MARK = /^[ \t]*#[ \t]?/;

export const isNoteSource = (source: string): boolean => source.trimStart().startsWith("#");

/** The text a note shows: its source without the leading "# " of each line. */
export const noteText = (source: string): string =>
  source
    .split("\n")
    .map((line) => line.replace(MARK, ""))
    .join("\n");

/** The source of a note showing this text; `noteText(noteSource(text)) === text` for any text. */
export const noteSource = (text: string): string =>
  text
    .split("\n")
    .map((line) => `# ${line}`)
    .join("\n");
