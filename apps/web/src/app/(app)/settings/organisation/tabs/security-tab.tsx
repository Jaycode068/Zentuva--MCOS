import { Badge, Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

const COMING_SOON_CARDS = [
  {
    title: 'Password Policy',
    description: 'Set minimum strength requirements for every user in this workspace.',
  },
  { title: 'Sessions', description: 'Workspace-wide session limits and forced sign-out controls.' },
  { title: 'MFA', description: 'Require multi-factor authentication for all members.' },
  { title: 'SSO', description: "Sign in with your organisation's identity provider." },
  { title: 'API Keys', description: "Programmatic access to your workspace's data." },
];

/**
 * Placeholder only, per the brief ("Do not implement"). This is workspace-wide security
 * *policy* — distinct from the per-user security page Sprint 3.3 already built at
 * `/account/security` (your own password/sessions), which is linked below rather than
 * duplicated here.
 */
export function SecurityTab() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Workspace-wide security policy. Looking for your own password or active sessions? Visit{' '}
        <a href="/account/security" className="font-medium text-primary hover:underline">
          Account Security
        </a>
        .
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {COMING_SOON_CARDS.map((card) => (
          <Card key={card.title} className="opacity-75">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{card.title}</CardTitle>
              <Badge variant="warning">Coming Soon</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{card.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
