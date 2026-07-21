/**
 * Grounding checks for an answer, in code (refs #246).
 *
 * This file used to hold a judge: a second model call that read the question,
 * the data and the answer, and returned a verdict. It was removed. Across the
 * real turns it ran on it never once caught a fabrication, rejected an accurate
 * answer every time it fired, and each rewrite that followed was worse than
 * what it replaced (one denied the data, one returned the raw tool JSON). A
 * small model judging another small model's output is the same mistake being
 * removed everywhere else in this codebase, with the added problem that a
 * verdict is the one output nothing can check.
 *
 * What replaces it is narrower and certain. Two ways of telling the user
 * something untrue are decidable by looking at the answer: claiming nothing was
 * found when rows exist, and returning the tool result instead of an answer.
 * Both are checked here, on every turn that fetched data, at no extra model
 * call. Everything else that used to be the judge's job is handled by supplying
 * the fact as data: counts, windows, object labels and dates are computed and
 * handed over, so there is nothing left for the model to derive and get wrong.
 */

/** Whether an answer claims nothing was found while the data says otherwise.
 *
 *  Decidable by looking, so it is decided here rather than asked of a model.
 *  The failure it catches is the worst one observed: a false rejection sent the
 *  model back to rewrite, and it answered "None of today's events were found to
 *  be related to people or vehicles" over a result carrying five events. An
 *  answer can be clumsy and still be useful; an answer that denies the data is
 *  worse than no answer, and the user has no way to tell it is wrong.
 *
 *  Deliberately narrow. It fires only on an explicit nothing-found claim, so an
 *  answer that merely omits something is left to the model check above. */
export function deniesTheData(answer: string, toolOutputs: string[]): boolean {
  const claimsNothing =
    /\b(?:none|no (?:events?|matches|results?|detections?|activity)|nothing (?:was )?(?:found|recorded)|were not found|not found)\b/i.test(
      answer,
    );
  if (!claimsNothing) return false;
  // A partial negative ("no animals, but 5 people came by") is describing the
  // data, not denying it: any positive count in the answer means the model saw
  // rows, so the nothing-found phrase is scoped, and correcting it would
  // replace a right answer with a rewrite.
  if (/\b[1-9]\d*\b/.test(answer)) return false;
  return toolOutputs.some((output) => {
    const match = /"matchCount"\s*:\s*(\d+)/.exec(output);
    return match !== null && Number(match[1]) > 0;
  });
}

/** Whether an answer is the tool result echoed back instead of written up.
 *
 *  Observed after a false rejection: told to rewrite, the model returned the
 *  entire `list_events` payload verbatim as its answer text, with the window
 *  silently altered. The user sees a wall of JSON.
 *
 *  Checked structurally rather than by comparing to the output, because the
 *  echo is rarely byte-identical: an answer to "summarize today" is prose, and
 *  a bare JSON object carrying the result's own field names is never a written
 *  answer regardless of which fields it copied. */
export function echoesToolOutput(answer: string): boolean {
  const text = answer.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  // The field names list_events uses. Two or more means the result object was
  // copied, not that the model happened to write JSON.
  const resultKeys = ['summary', 'window', 'matchCount', 'countsByMonitor', 'objectCounts', 'events'];
  return resultKeys.filter((key) => key in (parsed as Record<string, unknown>)).length >= 2;
}

/** Whether a rewritten answer is worse than the one it replaced.
 *
 *  Verification earns its round trip only if a retry can be trusted to be an
 *  improvement, and twice now it has not been: a 3B verifier rejected an
 *  accurate answer, and the rewrite that followed was in one case a denial of
 *  the data and in another the raw tool JSON. Both are decidable here, so the
 *  original answer is kept instead. A rejection can now only help or do
 *  nothing; it can no longer make the answer worse. */
export function retryIsUnusable(answer: string, toolOutputs: string[]): boolean {
  return answer.trim().length === 0 || echoesToolOutput(answer) || deniesTheData(answer, toolOutputs);
}

/**
 * A true sentence about the data, for when the model cannot produce one.
 *
 * `list_events` already writes its counts out (see result-summary.ts), so the
 * answer of last resort is that sentence: factual by construction, because
 * code built it from the rows. Better than shipping an answer known to be
 * wrong, and better than an error, since it actually answers the question.
 *
 * Returns undefined when no result carries a summary, leaving the caller to
 * decide what to do with an ungrounded answer.
 */
export function fallbackAnswerFromData(toolOutputs: string[]): string | undefined {
  for (const output of [...toolOutputs].reverse()) {
    try {
      const parsed = JSON.parse(output) as { summary?: unknown };
      if (typeof parsed.summary === 'string' && parsed.summary.length > 0) return parsed.summary;
    } catch {
      // Not JSON, so not a result carrying a summary. Try the next one.
    }
  }
  return undefined;
}

/** The correction for an answer that failed the grounding check rather than a
 *  judge. Names the specific fault, since these two are known exactly. */
export function buildGroundingCorrection(answer: string, toolOutputs: string[]): string {
  const fault = echoesToolOutput(answer)
    ? 'That was the raw tool result, not an answer. Write it out in words for the user.'
    : deniesTheData(answer, toolOutputs)
      ? 'You said nothing was found, but the tool results above contain matching events. Describe them.'
      : 'That answer does not follow from the tool results above.';
  return (
    `${fault} Use the summary line from the tool result as your first sentence, then add detail from ` +
    'the rows. Reply with the answer text itself: do not call any tool.'
  );
}
