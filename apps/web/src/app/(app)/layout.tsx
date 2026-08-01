import { WorkspaceLayout } from '@/components/workspace/WorkspaceLayout';

/**
 * Shared layout for every authenticated page (Sprint 3.5) — `/workspace`,
 * `/settings/organisation`, `/settings/users`, `/account/profile`, `/account/security`,
 * `/account/sessions`. A Next.js route group: `(app)` adds no URL segment, so every route
 * keeps its existing path while sharing one `WorkspaceLayout` instance instead of each
 * route's own `layout.tsx` importing the top nav separately.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceLayout>{children}</WorkspaceLayout>;
}
