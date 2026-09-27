/**
 * Sprint 30.1 — Public Recruitment Experience & Candidate Application Flow
 * (recruitment.md §"Successful Application Confirmation"). Deliberately does
 * NOT expose internal application status, screening/interview workflow
 * details, or promise an interview/employment outcome — only a plain,
 * reassuring confirmation that the submission was received.
 */
export function ApplicationSuccess({
  vacancyTitle,
  organisationName,
  organisationSlug,
}: {
  vacancyTitle: string;
  organisationName: string;
  organisationSlug: string;
}) {
  return (
    <div className="py-10 text-center">
      <div
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-2xl"
        aria-hidden="true"
      >
        ✓
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Application Submitted</h1>
      <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">
        Thank you for applying for the {vacancyTitle} position at {organisationName}. Your
        application has been received successfully.
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Our recruitment team will review your application and contact you if you are selected for
        the next stage.
      </p>
      <a
        href={`/careers/${organisationSlug}`}
        className="mt-6 inline-block text-sm font-medium text-primary underline underline-offset-4"
      >
        ← Back to all openings
      </a>
    </div>
  );
}
