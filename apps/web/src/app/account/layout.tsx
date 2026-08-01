import { AuthenticatedNav } from '@/components/app/authenticated-nav';

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <AuthenticatedNav />
      {children}
    </div>
  );
}
