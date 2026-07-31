import { Container, SectionHeading } from './container';
import {
  AiIcon,
  CrmIcon,
  DistributionIcon,
  FinanceIcon,
  HrIcon,
  InventoryIcon,
  ProcurementIcon,
  ProductionIcon,
  ReportingIcon,
  RetailIcon,
  SalesIcon,
} from './icons';

const MODULES = [
  {
    icon: ProductionIcon,
    title: 'Production',
    description: 'Plan runs, track output, and stay ahead of the factory floor in real time.',
  },
  {
    icon: InventoryIcon,
    title: 'Inventory',
    description: 'One accurate view of stock across every warehouse and location.',
  },
  {
    icon: ProcurementIcon,
    title: 'Procurement',
    description: 'Order raw materials on time, from suppliers you can actually track.',
  },
  {
    icon: SalesIcon,
    title: 'Sales',
    description: 'Manage orders and quotes without losing track of what shipped.',
  },
  {
    icon: DistributionIcon,
    title: 'Distribution',
    description: 'See exactly where every product goes after it leaves the factory.',
  },
  {
    icon: FinanceIcon,
    title: 'Finance',
    description: 'Connect operations to the numbers — no separate spreadsheet required.',
  },
  {
    icon: CrmIcon,
    title: 'CRM',
    description: 'Keep every customer and distributor relationship in one place.',
  },
  {
    icon: HrIcon,
    title: 'HR',
    description: 'Manage the people who run the business, alongside everything else.',
  },
  {
    icon: RetailIcon,
    title: 'Retail Intelligence',
    description: 'Understand demand at the shelf, not just at the warehouse door.',
  },
  {
    icon: ReportingIcon,
    title: 'Reporting',
    description: "Real-time dashboards built on operational data, not last month's export.",
  },
  {
    icon: AiIcon,
    title: 'Artificial Intelligence',
    description: 'Forecasting and decision support, built directly into the platform.',
  },
];

export function PlatformModules() {
  return (
    <section id="platform-modules" className="py-24">
      <Container>
        <SectionHeading
          eyebrow="Platform"
          title="Every module. One connected platform."
          description="Each part of Zentuva is built to work alone or together — designed as one system from the start, not stitched together after the fact."
        />

        <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="group rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-lg"
            >
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-lavender text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
