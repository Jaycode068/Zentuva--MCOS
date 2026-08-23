import {
  ArchiveIcon,
  AssetIcon,
  BanknoteIcon,
  BarChartIcon,
  BoxIcon,
  BuildingIcon,
  CartIcon,
  FactoryIcon,
  FileTextIcon,
  GridIcon,
  HelpCircleIcon,
  SendIcon,
  ShieldIcon,
  SlidersIcon,
  SupplierIcon,
  TrendingUpIcon,
  TruckIcon,
  UserIcon,
  UsersIcon,
  WrenchIcon,
  type WorkspaceIcon,
} from './icons';

export interface WorkspaceNavItem {
  label: string;
  href: string;
  icon: WorkspaceIcon;
  /** Undefined/false = fully working. `true` renders disabled with a "Coming Soon" badge
   *  per the Sprint 3.5 brief ("appear disabled, show 'Coming Soon', not generate
   *  errors — do not hide future modules"). */
  comingSoon?: boolean;
}

export interface WorkspaceNavGroup {
  label: string;
  items: WorkspaceNavItem[];
}

/**
 * Single source of truth for the Workspace sidebar (Sprint 3.5 brief §"Sidebar
 * Navigation") — `Sidebar`, `WorkspaceDashboardPage`'s Platform Modules grid, and any
 * future breadcrumb/search all read from this instead of duplicating the module list.
 * Adding a new module later means adding one entry here and flipping `comingSoon` to
 * `undefined` once its routes exist — no navigation component changes.
 */
export const WORKSPACE_NAV_GROUPS: WorkspaceNavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Dashboard', href: '/workspace', icon: GridIcon },
      { label: 'Products', href: '/settings/products', icon: BoxIcon },
      { label: 'Procurement', href: '/settings/procurement', icon: CartIcon },
      { label: 'Suppliers', href: '/settings/suppliers', icon: SupplierIcon },
      { label: 'Inventory', href: '/settings/inventory', icon: ArchiveIcon },
      { label: 'Production', href: '/settings/production', icon: FactoryIcon },
      {
        label: 'Asset Register',
        href: '/assets',
        icon: AssetIcon,
        comingSoon: true,
      },
      {
        label: 'Maintenance',
        href: '/maintenance',
        icon: WrenchIcon,
        comingSoon: true,
      },
      { label: 'Sales', href: '/settings/sales', icon: TrendingUpIcon },
      { label: 'Distribution', href: '/settings/distribution', icon: SendIcon },
      { label: 'Retail Network', href: '/settings/retail', icon: TruckIcon },
      { label: 'Field Sales', href: '/field', icon: TrendingUpIcon },
      { label: 'Finance', href: '/finance', icon: BanknoteIcon, comingSoon: true },
      { label: 'Reports', href: '/reports', icon: BarChartIcon, comingSoon: true },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Organisation', href: '/settings/organisation', icon: BuildingIcon },
      { label: 'Users', href: '/settings/users', icon: UsersIcon },
      { label: 'My Profile', href: '/account/profile', icon: UserIcon },
      {
        label: 'Workspace Settings',
        href: '/settings/workspace-config',
        icon: SlidersIcon,
        comingSoon: true,
      },
      { label: 'Security', href: '/account/security', icon: ShieldIcon },
    ],
  },
  {
    label: 'Support',
    items: [
      { label: 'Help', href: '/help', icon: HelpCircleIcon, comingSoon: true },
      { label: 'Release Notes', href: '/release-notes', icon: FileTextIcon, comingSoon: true },
    ],
  },
];

/** Flat lookup, used by the Topbar to resolve the current page title from `pathname`. */
export const WORKSPACE_NAV_ITEMS: WorkspaceNavItem[] = WORKSPACE_NAV_GROUPS.flatMap(
  (group) => group.items,
);
