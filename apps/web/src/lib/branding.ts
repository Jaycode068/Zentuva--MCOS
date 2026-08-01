'use client';

import { useEffect } from 'react';

/**
 * Sprint 3.4 Branding tab: applies a tenant's chosen primary/accent colours and theme
 * preference as CSS custom-property overrides on `<html>`, so every component that
 * already reads `hsl(var(--primary))`/`hsl(var(--accent-pink))` (via
 * `packages/config/tailwind/preset.js`'s `primary`/`accentPink` colour tokens) picks up
 * the tenant's branding automatically — no component needs to know branding exists.
 *
 * Deliberately does NOT touch `--brand-purple`: per the brief's UI Requirements ("Deep
 * Purple — Platform identity"), that colour stays Zentuva's own identity across every
 * tenant. Only the interactive layer (primary/accent) is tenant-customisable.
 */
export interface WorkspaceBranding {
  primaryColor: string | null;
  accentColor: string | null;
  theme: 'light' | 'dark' | 'system';
}

export function useApplyBranding(branding: WorkspaceBranding | undefined): void {
  useEffect(() => {
    if (!branding) return undefined;
    return applyBranding(branding);
  }, [branding]);
}

/** Returns a cleanup function (removes the `prefers-color-scheme` listener registered
 *  for `theme: 'system'`, a no-op for 'light'/'dark'). */
export function applyBranding(branding: WorkspaceBranding): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }
  const root = document.documentElement;

  applyColorOverride(root, '--primary', '--primary-foreground', branding.primaryColor);
  applyColorOverride(root, '--ring', undefined, branding.primaryColor);
  applyColorOverride(root, '--accent-pink', '--accent-pink-foreground', branding.accentColor);

  return applyThemeClass(root, branding.theme);
}

function applyColorOverride(
  root: HTMLElement,
  variable: string,
  foregroundVariable: string | undefined,
  hex: string | null,
): void {
  if (!hex) {
    root.style.removeProperty(variable);
    if (foregroundVariable) root.style.removeProperty(foregroundVariable);
    return;
  }
  const hsl = hexToHslTriplet(hex);
  if (!hsl) return;

  root.style.setProperty(variable, hsl);
  if (foregroundVariable) {
    root.style.setProperty(foregroundVariable, readableForeground(hsl));
  }
}

function applyThemeClass(root: HTMLElement, theme: WorkspaceBranding['theme']): () => void {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function update() {
    const isDark = theme === 'dark' || (theme === 'system' && mediaQuery.matches);
    root.classList.toggle('dark', isDark);
  }

  update();
  if (theme === 'system') {
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }
  return () => {};
}

/** `"#RRGGBB"` or `"#RGB"` → `"H S% L%"`, matching the space-separated triplet format
 *  every existing token in `packages/ui/src/styles.css` already uses. Returns `null` for
 *  anything that isn't a valid hex colour (defensive — the Zod schema should have already
 *  rejected it before it reaches here). */
export function hexToHslTriplet(hex: string): string | null {
  const normalized = hex.trim().replace('#', '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => char + char)
          .join('')
      : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return null;
  }

  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Simple lightness-threshold contrast pick — good enough for a solid-colour background,
 *  not a full WCAG contrast calculation. */
function readableForeground(hslTriplet: string): string {
  const match = hslTriplet.match(/(\d+)%\s*$/);
  const lightness = match?.[1] ? parseInt(match[1], 10) : 50;
  return lightness < 60 ? '0 0% 100%' : '240 10% 8%';
}
