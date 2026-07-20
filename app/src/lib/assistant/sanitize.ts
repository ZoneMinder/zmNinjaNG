/**
 * Repairs model output that arrives with byte-fallback tokens as literal text
 * (refs #246).
 *
 * SentencePiece vocabularies (gemma, llama, qwen) encode a character they do
 * not have a token for as a run of single-byte tokens named `<0xNN>`. Decoding
 * is supposed to turn those names back into the bytes they stand for. When a
 * runtime fails to, the names reach the caller as ASCII text and the user sees
 * `08:20<0xE2><0x80><0xAF>AM` where the model wrote a narrow no-break space.
 *
 * Observed with gemma4 through Ollama, on U+202F and U+00A0 (the thin spaces it
 * puts before "AM" and before a unit). Not model-specific and not backend
 * specific, which is why this lives here rather than in one provider: any
 * SentencePiece model can emit these, and any runtime can fail to decode them.
 *
 * Decode rather than strip. Deleting the run would join the words either side
 * ("08:20AM"), turning a visible defect into a silent one.
 *
 * This matters beyond cosmetics. Assistant text is stored in the thread and
 * replayed to the model on every later turn, so uncorrected output becomes an
 * example the model imitates. Repairing here, before the text is stored, keeps
 * the corruption from compounding.
 */
import { log, LogLevel } from '../logger';

/** One or more adjacent `<0xNN>` tokens: a multi-byte character arrives as a
 *  run, so they are decoded together rather than one at a time. */
const BYTE_TOKEN_RUN = /(?:<0x[0-9A-Fa-f]{2}>)+/g;

/** Strict: an invalid sequence must throw so the caller can leave the original
 *  text alone instead of writing U+FFFD over it. */
const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Replaces every decodable `<0xNN>` run with the character it encodes.
 *
 * A run that is not valid UTF-8 is left exactly as it was: it is not something
 * this function understands, and mangling it further would destroy the evidence
 * of whatever produced it.
 */
export function decodeByteFallbackTokens(text: string): string {
  if (!text.includes('<0x')) return text;
  return text.replace(BYTE_TOKEN_RUN, (run) => {
    const bytes = Uint8Array.from(
      run.match(/<0x([0-9A-Fa-f]{2})>/g)!.map((token) => parseInt(token.slice(3, 5), 16)),
    );
    try {
      return utf8.decode(bytes);
    } catch {
      return run;
    }
  });
}

/**
 * The integrity check for one piece of model output, in code.
 *
 * Deliberately not a job for the verification round: whether text is corrupted
 * is decidable by looking at it, and a model asked to check its own output for
 * mangled bytes both costs a call and can be wrong. The verifier reads the
 * answer for meaning; this reads it for damage. It caught nothing when it was
 * the verifier's job, and passed a rewrite that still carried the tokens.
 *
 * Returns the repaired text and logs anything it could not repair, so a new
 * corruption shape shows up in the logs instead of reaching the user silently.
 */
export function sanitizeModelText(text: string, context: string): string {
  const repaired = decodeByteFallbackTokens(text);
  if (repaired !== text) {
    log.assistant('Repaired byte-fallback tokens in model output', LogLevel.WARN, { context });
  }
  if (repaired.includes('<0x')) {
    log.assistant('Model output still carries undecodable byte tokens', LogLevel.WARN, {
      context,
      sample: repaired.slice(repaired.indexOf('<0x'), repaired.indexOf('<0x') + 60),
    });
  }
  return repaired;
}
