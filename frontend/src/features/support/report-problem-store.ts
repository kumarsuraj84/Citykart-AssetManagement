import { create } from "zustand";

/** What a "Report a problem" opened from an error attaches (the failing request, the error). */
export interface ReportContext {
  requestId?: string | null;
  message?: string | null;
  stack?: string | null;
}

interface ReportProblemState {
  open: boolean;
  context: ReportContext | null;
  openReport: (context?: ReportContext | null) => void;
  close: () => void;
}

/** S8: one "Report a problem" dialog for the whole app (mounted once in the app shell). */
export const useReportProblem = create<ReportProblemState>()((set) => ({
  open: false,
  context: null,
  openReport: (context = null) => set({ open: true, context }),
  close: () => set({ open: false, context: null }),
}));
