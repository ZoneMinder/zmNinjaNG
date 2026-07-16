/**
 * Ninjii's empty-thread self-introduction (refs #246).
 *
 * Rendered by `AskPanel` only while the current profile's thread is empty
 * (fresh open, or right after Clear): a UI empty state, not a message in the
 * thread, so it is never sent to the model as history. Clicking an example
 * prompt fills the input rather than sending immediately, so the user can
 * edit it before it becomes a real turn.
 */
import { useTranslation } from 'react-i18next';
import { ASSISTANT } from '../../lib/zmninja-ng-constants';

export interface AssistantIntroProps {
  onExampleClick: (text: string) => void;
}

export function AssistantIntro({ onExampleClick }: AssistantIntroProps) {
  const { t } = useTranslation();
  const examples = [
    t('assistant.intro_example_1'),
    t('assistant.intro_example_2'),
    t('assistant.intro_example_3'),
  ];

  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center" data-testid="assistant-intro">
      <img src={ASSISTANT.logoPath} alt={t('assistant.title')} className="h-16 w-16 rounded-full" />
      <p className="text-sm font-medium">{t('assistant.intro_greeting')}</p>
      <p className="text-xs text-muted-foreground">{t('assistant.intro_help')}</p>
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            data-testid="assistant-example-prompt"
            onClick={() => onExampleClick(example)}
            className="rounded-full border border-input px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
