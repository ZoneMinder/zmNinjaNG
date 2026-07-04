/**
 * General Utilities
 * 
 * Common helper functions used throughout the application.
 */

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { KeyboardEvent } from "react"

/**
 * Merge Tailwind CSS classes with clsx.
 * Handles conditional classes and resolves conflicts using tailwind-merge.
 * 
 * @param inputs - Class names, objects, or arrays
 * @returns Merged class string
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Escapes HTML entities to prevent XSS attacks.
 * Useful when rendering user-provided content.
 * 
 * @param str - The string to escape
 * @returns The escaped string safe for HTML insertion
 */
export function escapeHtml(str: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
  };
  return str.replace(/[&<>"'/]/g, (match) => htmlEntities[match]);
}

/**
 * Formats large numbers with k/M suffixes.
 * Numbers >= 1000 show as "1k+", >= 1000000 show as "1M+"
 * 
 * @param count - The number to format
 * @returns Formatted string (e.g., "300", "999", "1k+", "3M+")
 */
export function formatEventCount(count: number | undefined): string {
  if (count === undefined || count === null) return '0';

  if (count >= 1000000) {
    return `${Math.floor(count / 1000000)}M+`;
  }

  if (count >= 1000) {
    return `${Math.floor(count / 1000)}k+`;
  }

  return count.toString();
}

/**
 * Builds a keydown handler that runs `handler` on Enter or Space, matching
 * native button activation. Use on non-button elements (div/span) that carry
 * an onClick and an interactive role (e.g. role="button"/"radio") so they're
 * operable from the keyboard (WCAG 2.1.1). refs #217.
 *
 * @param handler - Callback to invoke on activation
 * @returns A React onKeyDown handler
 */
export function activateOnEnterOrSpace(handler: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
}
