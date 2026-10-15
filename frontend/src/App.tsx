import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { ErrorBoundary, ErrorFallback } from "@/components/shared/ErrorBoundary";
import { ReportProblemDialog } from "@/features/support/ReportProblemDialog";
import { queryClient } from "./lib/query-client";
import { router } from "./router";

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* S8: anything that crashes outside a route's own error screen (the router shows that one). */}
      <ErrorBoundary
        fallback={(error, reset) => (
          <>
            <ErrorFallback error={error} onRetry={reset} fullPage />
            <ReportProblemDialog />
          </>
        )}
      >
        <RouterProvider router={router} />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

export default App;
