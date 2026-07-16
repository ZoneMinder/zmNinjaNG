/**
 * Host hook bridging the store-free assistant agent library to React
 * (refs #246).
 *
 * `lib/assistant/agent.ts` and its tools take an `AssistantHost` and never
 * import a zustand store directly (rule 31: services never statically import
 * stores). This hook is the one place that closes that gap for the real app:
 * `confirm` parks a `ConfirmRequest` in local state and hands the agent loop
 * back a Promise that only `resolveConfirm` (called by AskPanel, wired to the
 * confirm card's buttons, an abort, or an unmount) can settle. `navigate`
 * closes the command palette before routing so the agent's `navigate` tool
 * call collapses the panel as a side effect, exactly as the forward contract
 * from the agent loop (agent.ts's `navigate`/`closePanel` comment) expects.
 */
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssistantHost, ConfirmRequest } from '../../lib/assistant/types';
import { useAssistantStore } from '../../stores/assistant';
import { useCommandPaletteStore } from '../../stores/commandPalette';

export function useAssistantHost() {
  const navigate = useNavigate();
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const pushActivity = useAssistantStore((s) => s.pushActivity);
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const resolveConfirm = useCallback((ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setPendingConfirm(null);
  }, []);

  const host: AssistantHost = {
    confirm: (request) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setPendingConfirm(request);
      }),
    navigate: (path) => {
      setOpen(false);
      navigate(path);
    },
    onActivity: (a) => pushActivity(a),
  };

  return { host, pendingConfirm, resolveConfirm };
}
