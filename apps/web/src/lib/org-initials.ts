/** Shared by `AuthenticatedNav` and the Branding tab's logo-fallback avatar (Sprint 3.4
 *  brief: "if no logo exists, show a beautiful initials avatar"). */
export function orgInitialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]!.charAt(0)}${words[1]!.charAt(0)}`.toUpperCase();
}
