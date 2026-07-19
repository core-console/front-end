import { Button } from "@/components/ui/button";

function App() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Vite + React + shadcn/ui
        </h1>
        <p className="text-muted-foreground">
          Tailwind CSS 与路径别名配置成功。
        </p>
        <Button>shadcn/ui Button</Button>
      </div>
    </main>
  );
}

export default App;
