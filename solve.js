// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// run(input) returns exactly what csv-reader 1.0.0 returns for {text, header}:
// {columns, rows, errors}. The reference reads one character at a time; this
// module reads with indexOf scans instead, which is the whole speedup:
//
//   - Most records hold no quote and no stray CR before their line break, so
//     a record is split with a few indexOf calls and String.slice, no
//     per-character loop at all.
//   - A record that does hold a quote (or a stray CR) takes the slow path,
//     which follows the reference field by field, but still jumps between
//     delimiters with indexOf instead of stepping character by character.
//
// The broken-row policy is the reference's own, kept exactly:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it is one quote, and each CRLF or lone CR inside it
//     is read as LF; what follows its closing quote, up to the next comma or
//     line break, is appended as it stands (quote_junk, when the field ends);
//     a quote that never closes is a literal character, and the text after it
//     is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded with "" (short_row, with fields: its
//     field count) or cut (long_row, with extra: the cut fields) to the first
//     record's width;
//   - each error is {code, line, row}, in the order met: line the 1-based
//     line its record starts on, row its record's index in rows, null for
//     the header.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Dependency-free ES module.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Finishes a record's fields: header, or a row padded/cut to the first
  // record's width, with its short_row/long_row error when it ends.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the field
  // and how it ended; `added` counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    while (pos < len) {
      const c = text.indexOf(',', pos);
      const n = text.indexOf('\n', pos);
      let end;
      let kind;
      if (c === -1 && n === -1) {
        end = len;
        kind = END;
      } else if (c === -1) {
        end = n;
        kind = LINE_BREAK;
      } else if (n === -1) {
        end = c;
        kind = COMMA;
      } else if (c < n) {
        end = c;
        kind = COMMA;
      } else {
        end = n;
        kind = LINE_BREAK;
      }
      const r = text.indexOf('\r', pos);
      if (r !== -1 && r < end) {
        if (kind === LINE_BREAK && r === end - 1) {
          // CRLF: the CR is the line break's own, dropped with no error.
          if (end - 1 > pos) {
            value += text.slice(pos, end - 1);
            added += end - 1 - pos;
          }
          pos = end + 1;
          line += 1;
          return { value, ended: LINE_BREAK, added };
        }
        // Stray CRs: walk this short stretch, dropping each CR (one
        // stray_cr error each) and keeping the rest as it stands. A CR
        // that ends the stretch at a line break is the CRLF's own, so the
        // walk stops one character short of it and drops it with no error.
        let stop = end;
        if (kind === LINE_BREAK && text.charCodeAt(end - 1) === 13) stop = end - 1;
        for (let i = pos; i < stop; i++) {
          const ch = text[i];
          if (ch === '\r') error('stray_cr');
          else {
            value += ch;
            added += 1;
          }
        }
        pos = end;
        if (kind === COMMA) {
          pos += 1;
          return { value, ended: COMMA, added };
        }
        if (kind === LINE_BREAK) {
          pos += 1;
          line += 1;
          return { value, ended: LINE_BREAK, added };
        }
        return { value, ended: END, added };
      }
      if (end > pos) {
        value += text.slice(pos, end);
        added += end - pos;
      }
      pos = end;
      if (kind === COMMA) {
        pos += 1;
        return { value, ended: COMMA, added };
      }
      if (kind === LINE_BREAK) {
        pos += 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      return { value, ended: END, added };
    }
    return { value, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    while (pos < len) {
      const q = text.indexOf('"', pos);
      const r = text.indexOf('\r', pos);
      const n = text.indexOf('\n', pos);
      let m = q;
      let kind = 0; // 0 quote, 1 CR, 2 LF
      if (m === -1 || (r !== -1 && r < m)) {
        m = r;
        kind = 1;
      }
      if (m === -1 || (n !== -1 && n < m)) {
        m = n;
        kind = 2;
      }
      if (m === -1) {
        value += text.slice(pos);
        pos = len;
        break;
      }
      if (kind === 0) {
        value += text.slice(pos, m);
        if (text.charCodeAt(m + 1) === 34) {
          value += '"';
          pos = m + 2;
          continue;
        }
        pos = m + 1;
        closed = true;
        break;
      }
      if (kind === 1) {
        // CRLF and a lone CR inside quotes are each one LF.
        value += text.slice(pos, m);
        value += '\n';
        line += 1;
        pos = text.charCodeAt(m + 1) === 10 ? m + 2 : m + 1;
        continue;
      }
      value += text.slice(pos, m);
      value += '\n';
      line += 1;
      pos = m + 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    if (pos >= len) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const cc = text.charCodeAt(pos);
      if (cc === 10) {
        pos += 1;
        line += 1;
      } else if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: this record's line holds no quote and no stray CR, so the
    // record ends at its line break and splits on commas alone.
    const nl = text.indexOf('\n', pos);
    const segEnd = nl === -1 ? len : nl;
    const q = text.indexOf('"', pos);
    if (q === -1 || q >= segEnd) {
      const r = text.indexOf('\r', pos);
      const crlf = nl !== -1 && r === segEnd - 1;
      if (r === -1 || r >= segEnd || crlf) {
        const fieldEnd = crlf ? segEnd - 1 : segEnd;
        const fields = [];
        let s = pos;
        while (true) {
          const c = text.indexOf(',', s);
          if (c === -1 || c >= fieldEnd) {
            fields.push(text.slice(s, fieldEnd));
            break;
          }
          fields.push(text.slice(s, c));
          s = c + 1;
        }
        pos = nl === -1 ? len : nl + 1;
        if (nl !== -1) line += 1;
        if (!(fields.length === 1 && fields[0] === '')) finishRecord(fields);
        continue;
      }
    }

    // Slow path: the record holds a quote or a stray CR.
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
