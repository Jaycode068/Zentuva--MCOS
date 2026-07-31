import type { SVGProps } from 'react';

/** Minimal line-icon set for the marketing site — no icon library dependency. */

function Base(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

export const ProductionIcon = (props: SVGProps<SVGSVGElement>) => (
  <Base {...props}>
    <path d="M3 20h18M5 20V10l4 3v-3l4 3v-3l4 3v7M19 20V7h2" />
  </Base>
);

export const InventoryIcon = (props: SVGProps<SVGSVGElement>) => (
  <Base {...props}>
    <path d="M21 8l-9-5-9 5 9 5 9-5Z" />
    <path d="M3 8v8l9 5 9-5V8M12 13v8" />
  </Base>
);

export const ProcurementIcon = (props: SVGProps<SVGSVGElement>) => (
  <Base {...props}>
    <path d="M3 7h13l3 5v6h-3M3 7v10h3M9 7V4h9v3" />
    <circle cx="7.5" cy="18" r="1.75" />
    <circle cx="17.5" cy="18" r="1.75" />
  </Base>
);

export const SalesIcon = (props: SVGProps<SVGSVGElement>) => (
  <Base {...props}>
    <circle cx="9" cy="20" r="1.5" />
    <circle cx="17" cy="20" r="1.5" />
    <path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.8h7.2a2 2 0 0 0 2-1.6L20 8H6" />
  </Base>
);

export const DistributionIcon = (props: SVGProps<SVGSVGElement>) => (
  <Base {...props}>
    <circle cx="12" cy="5" r="2" />
    <circle cx="5" cy="19" r="2" />
    <circle cx="19" cy="19" r="2" />
    <path d="M12 7v6M12 13l-5.5 4M12 13l5.5 4" />
  </Base>
);

export const FinanceIcon = (props: SVGProps<SVGSVGElement>) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v10M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1-3 2.3c0 3 6 1.4 6 4.4 0 1.3-1.3 2.3-3 2.3s-3-1.1-3-2.5" />
  </Base>
);

export const CrmIcon = (props: SVGProps<SVGSVGElement>) => (
  <Base {...props}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.3a3 3 0 0 1 0 5.8M20 20c0-2.5-1.6-4.7-4-5.6" />
  </Base>
);

export const HrIcon = (props: SVGProps<SVGSVGElement>) => (
  <Base {...props}>
    <circle cx="12" cy="7" r="3.5" />
    <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
    <path d="M15.5 4.5l1.2 1.2 2.3-2.3" />
  </Base>
);

export const RetailIcon = (props: SVGProps<SVGSVGElement>) => (
  <Base {...props}>
    <path d="M4 9l1-5h14l1 5M4 9v10h16V9M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" />
  </Base>
);

export const ReportingIcon = (props: SVGProps<SVGSVGElement>) => (
  <Base {...props}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Base>
);

export const AiIcon = (props: SVGProps<SVGSVGElement>) => (
  <Base {...props}>
    <path d="M12 3l1.6 3.9L17.5 8l-3.9 1.6L12 13.5l-1.6-3.9L6.5 8l3.9-1.1L12 3Z" />
    <path d="M19 15l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9Z" />
  </Base>
);

export const NetworkIcon = (props: SVGProps<SVGSVGElement>) => (
  <Base {...props}>
    <circle cx="5" cy="6" r="2.2" />
    <circle cx="19" cy="6" r="2.2" />
    <circle cx="5" cy="18" r="2.2" />
    <circle cx="19" cy="18" r="2.2" />
    <circle cx="12" cy="12" r="2.4" />
    <path d="M7 7.3 10 10M17 7.3 14 10M7 16.7 10 14M17 16.7 14 14" />
  </Base>
);
