import { Button } from '@zentuva/ui';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-24">
      <h1 className="text-3xl font-bold">Zentuva</h1>
      <p className="text-muted-foreground">
        Manufacturing &amp; Commerce Operating System — engineering foundation.
      </p>
      <Button>Foundation Ready</Button>
    </main>
  );
}
