/**
 * Sprint 30.1 — Public Recruitment Experience & Candidate Application Flow.
 * The one shared shell every public `/careers/*` page renders inside —
 * consistent max-width/padding/typography across the landing page, a vacancy
 * detail page, and the apply form, for every tenant. Deliberately no header
 * navigation, no footer links back into the authenticated app — a public
 * candidate has no Zentuva account and should never be invited to look for
 * one here.
 */
export function PublicCareersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">{children}</main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Powered by Zentuva
      </footer>
    </div>
  );
}
