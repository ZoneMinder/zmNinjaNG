/**
 * Password Input Component
 *
 * A specialized input component for passwords that includes a visibility toggle.
 * Wraps the standard Input component and adds an eye icon button to switch
 * between 'password' and 'text' types.
 */

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from './input';
import { Button } from './button';
import { cn } from '../../lib/utils';
import { useTranslation } from 'react-i18next';

export interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * Whether to show the toggle visibility button
   * @default true
   */
  showToggle?: boolean;
  /**
   * Classes for the inner `<input>` itself (height, text size, etc.). Width and
   * layout classes belong on `className`, which sizes the positioned wrapper so
   * the reveal toggle stays anchored to the field edge. Passing a width here
   * would collapse the wrapper in a flex row and clip the value under the eye.
   */
  inputClassName?: string;
}

/**
 * PasswordInput component.
 *
 * @param props - Component properties
 * @param props.showToggle - Whether to show the visibility toggle button
 * @param props.className - Wrapper classes (width/layout); sizes the field
 * @param props.inputClassName - Inner input classes (height, text size)
 */
const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, inputClassName, showToggle = true, ...props }, ref) => {
    const [showPassword, setShowPassword] = React.useState(false);
    const { t } = useTranslation();

    return (
      <div className={cn('relative', className)}>
        <Input
          type={showPassword ? 'text' : 'password'}
          className={cn('w-full pr-12', inputClassName)}
          ref={ref}
          {...props}
        />
        {showToggle && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
            onClick={() => setShowPassword((prev) => !prev)}
            title={showPassword ? t('common.hide_password') : t('common.show_password')}
            aria-label={showPassword ? t('common.hide_password') : t('common.show_password')}
            tabIndex={-1}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            )}
          </Button>
        )}
      </div>
    );
  }
);

PasswordInput.displayName = 'PasswordInput';

export { PasswordInput };
