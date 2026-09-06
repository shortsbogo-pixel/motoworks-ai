declare namespace Cloudflare {
  interface Env {
    FILES: R2Bucket;
  }
}

declare module 'lucide-react' {
  import * as React from 'react';
  export type LucideProps = React.SVGProps<SVGSVGElement> & {
    size?: number | string;
    strokeWidth?: number | string;
    absoluteStrokeWidth?: boolean;
    color?: string;
  };
  export type LucideIcon = React.ForwardRefExoticComponent<
    LucideProps & React.RefAttributes<SVGSVGElement>
  >;

  export const Activity: LucideIcon;
  export const AlertTriangle: LucideIcon;
  export const ArrowDownIcon: LucideIcon;
  export const BadgeCheck: LucideIcon;
  export const Bike: LucideIcon;
  export const Camera: LucideIcon;
  export const Check: LucideIcon;
  export const CheckIcon: LucideIcon;
  export const ChevronDownIcon: LucideIcon;
  export const ChevronLeftIcon: LucideIcon;
  export const ChevronRight: LucideIcon;
  export const ChevronRightIcon: LucideIcon;
  export const ChevronUpIcon: LucideIcon;
  export const CircleCheckIcon: LucideIcon;
  export const CircleDollarSign: LucideIcon;
  export const ClipboardCheck: LucideIcon;
  export const CloudUpload: LucideIcon;
  export const Database: LucideIcon;
  export const FileDown: LucideIcon;
  export const FileSpreadsheet: LucideIcon;
  export const History: LucideIcon;
  export const InfoIcon: LucideIcon;
  export const LayoutDashboard: LucideIcon;
  export const ListChecks: LucideIcon;
  export const Loader2Icon: LucideIcon;
  export const Menu: LucideIcon;
  export const MinusIcon: LucideIcon;
  export const MoreHorizontalIcon: LucideIcon;
  export const OctagonXIcon: LucideIcon;
  export const PanelLeftIcon: LucideIcon;
  export const ReceiptText: LucideIcon;
  export const ScanLine: LucideIcon;
  export const Search: LucideIcon;
  export const SearchIcon: LucideIcon;
  export const Settings2: LucideIcon;
  export const ShieldCheck: LucideIcon;
  export const Store: LucideIcon;
  export const TriangleAlertIcon: LucideIcon;
  export const Users: LucideIcon;
  export const WalletCards: LucideIcon;
  export const X: LucideIcon;
  export const XIcon: LucideIcon;

  const icons: Record<string, LucideIcon>;
  export default icons;
}
