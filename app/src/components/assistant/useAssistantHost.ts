/**
 * Host hook bridging the store-free assistant agent library to React
 * (refs #246).
 *
 * `lib/assistant/agent.ts` and its tools take an `AssistantHost` and never
 * import a zustand store directly (rule 31: services never statically import
 * stores). This hook is the one place that closes that gap for the real app.
 * `navigate` minimizes the floating assistant window
 * (`stores/assistantPanel.ts`) before routing, so the agent's `navigate` tool
 * call (or an "Open" result-card click) collapses it to the FAB instead of
 * closing it, exactly as the forward contract from the agent loop (agent.ts's
 * `navigate`/`closePanel` comment) expects: the conversation underneath
 * survives the navigation.
 *
 * There is no `confirm` here any more. The assistant is read-only, so no tool
 * can ask the user to approve anything (see TOOLS in lib/assistant/tools.ts).
 */
import { useNavigate } from 'react-router-dom';
import type { AssistantHost } from '../../lib/assistant/types';
import { useAssistantStore } from '../../stores/assistant';
import { useAssistantPanelStore } from '../../stores/assistantPanel';

export function useAssistantHost() {
  const navigate = useNavigate();
  const minimizePanel = useAssistantPanelStore((s) => s.minimize);
  const pushActivity = useAssistantStore((s) => s.pushActivity);

  const host: AssistantHost = {
    navigate: (path) => {
      minimizePanel();
      navigate(path);
    },
    onActivity: (a) => pushActivity(a),
  };

  return { host };
}
