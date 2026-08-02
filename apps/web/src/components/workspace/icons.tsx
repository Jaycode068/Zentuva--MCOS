/**
 * Small hand-rolled stroke-icon set for the Workspace shell (Sidebar/Topbar/ModuleCard).
 * Same rationale as `Dialog`/`DropdownMenu` (Sprints 2.2/3.3) and the marketing `Logo`
 * (Sprint 3.1): no icon-library dependency exists in this repo yet, and ~20 simple,
 * consistently-styled outline icons are cheaper than adding one. All icons share a 24x24
 * viewBox, `currentColor` stroke, and take a `className` for sizing/color — consumers
 * size them with Tailwind (e.g. `className="h-5 w-5"`).
 */
import type { SVGProps } from 'react';

export type WorkspaceIcon = (props: SVGProps<SVGSVGElement>) => React.JSX.Element;

function icon(paths: React.JSX.Element): WorkspaceIcon {
  function IconComponent(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {paths}
      </svg>
    );
  }
  return IconComponent;
}

export const GridIcon = icon(
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </>,
);

export const BoxIcon = icon(
  <>
    <path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z" />
    <path d="M3 7.5 12 12l9-4.5M12 12v9" />
  </>,
);

export const CartIcon = icon(
  <>
    <circle cx="9" cy="20" r="1.25" />
    <circle cx="18" cy="20" r="1.25" />
    <path d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 8H6" />
  </>,
);

export const ArchiveIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
    <path d="M10 13h4" />
  </>,
);

export const FactoryIcon = icon(
  <>
    <path d="M3 21V10l6 4v-4l6 4V6l6 4v11H3Z" />
    <path d="M7 21v-4M12 21v-4M17 21v-4" />
  </>,
);

export const TrendingUpIcon = icon(
  <>
    <path d="M3 17 9 11l4 4 8-8" />
    <path d="M15 7h6v6" />
  </>,
);

export const TruckIcon = icon(
  <>
    <rect x="2" y="7" width="13" height="10" rx="1" />
    <path d="M15 10h4l3 3.5V17h-7" />
    <circle cx="7" cy="18.5" r="1.5" />
    <circle cx="17.5" cy="18.5" r="1.5" />
  </>,
);

export const BanknoteIcon = icon(
  <>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="3" />
    <path d="M6 10v.01M18 14v.01" />
  </>,
);

export const BarChartIcon = icon(
  <>
    <path d="M4 20V10M12 20V4M20 20v-7" />
    <path d="M2 20h20" />
  </>,
);

export const BuildingIcon = icon(
  <>
    <rect x="4" y="3" width="16" height="18" rx="1" />
    <path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1" />
    <path d="M10 21v-4h4v4" />
  </>,
);

export const UsersIcon = icon(
  <>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.5a3.25 3.25 0 0 1 0 6.4" />
    <path d="M18.5 14a6.3 6.3 0 0 1 3 5.3" />
  </>,
);

export const UserIcon = icon(
  <>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </>,
);

export const SlidersIcon = icon(
  <>
    <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h13M21 18h-1" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="19" cy="18" r="2" />
  </>,
);

export const ShieldIcon = icon(
  <>
    <path d="M12 3 5 6v6c0 4.4 3 7.7 7 9 4-1.3 7-4.6 7-9V6l-7-3Z" />
    <path d="m9.5 12 2 2 3.5-4" />
  </>,
);

export const HelpCircleIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.3 9a2.7 2.7 0 1 1 3.6 2.5c-.9.4-1.4 1-1.4 2" />
    <path d="M12 17h.01" />
  </>,
);

export const FileTextIcon = icon(
  <>
    <path d="M7 3h7l4 4v14H7Z" />
    <path d="M14 3v4h4" />
    <path d="M9 13h6M9 17h6" />
  </>,
);

export const SupplierIcon = icon(
  <>
    <path d="M3 21V9l6-4 6 4v12" />
    <path d="M9 21v-6h4v6" />
    <path d="M15 21V11l6-3v13h-6" />
  </>,
);

export const AssetIcon = icon(
  <>
    <rect x="3" y="3" width="18" height="14" rx="1.5" />
    <path d="M8 21h8M12 17v4" />
    <circle cx="12" cy="10" r="3" />
  </>,
);

export const WrenchIcon = icon(
  <>
    <path d="M14.7 6.3a4 4 0 0 0-5.4 4.7L3 17.3V21h3.7l6.3-6.3a4 4 0 0 0 4.7-5.4l-2.8 2.8-2-2 2.8-2.8Z" />
  </>,
);

export const MenuIcon = icon(<path d="M3 6h18M3 12h18M3 18h18" />);

export const CloseIcon = icon(<path d="M6 6l12 12M18 6 6 18" />);

export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />);

export const LogOutIcon = icon(
  <>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <path d="M10 17l5-5-5-5" />
    <path d="M15 12H3" />
  </>,
);
