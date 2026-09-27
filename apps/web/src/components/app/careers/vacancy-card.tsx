import { Badge, Card, CardContent, CardHeader, CardTitle } from '@zentuva/ui';

import type { PublicVacancySummary } from '@/app/careers/api';

function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Sprint 30.1 — Public Recruitment Experience & Candidate Application Flow.
 * One open position, as shown on the tenant careers landing page. Purely
 * presentational — every field comes from the vacancy the caller passes in,
 * nothing hardcoded per tenant.
 */
export function VacancyCard({
  vacancy,
  organisationSlug,
}: {
  vacancy: PublicVacancySummary;
  organisationSlug: string;
}) {
  return (
    <a href={`/careers/${organisationSlug}/${vacancy.publicSlug}`} className="block">
      <Card className="transition-colors hover:border-primary/50 hover:bg-secondary/30">
        <CardHeader className="pb-3">
          <CardTitle>{vacancy.title}</CardTitle>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {vacancy.departmentName && <Badge>{vacancy.departmentName}</Badge>}
            <Badge variant="success">{formatEnum(vacancy.employmentType)}</Badge>
            <Badge>{formatEnum(vacancy.workArrangement)}</Badge>
            {vacancy.location && <Badge>{vacancy.location}</Badge>}
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between pt-0">
          {vacancy.applicationDeadline ? (
            <p className="text-xs text-muted-foreground">
              Applications close {new Date(vacancy.applicationDeadline).toLocaleDateString()}
            </p>
          ) : (
            <span />
          )}
          <span className="text-sm font-medium text-primary">View Position →</span>
        </CardContent>
      </Card>
    </a>
  );
}
