import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LoginForm } from "./routes/login";
import { apiClient } from "./lib/api-client";
import { useAuthStore } from "./lib/auth-store";

const queryClient = new QueryClient();

// TODO(task 7+): load the company list from the API instead of hard-coding it.
const companies = [{ id: 1, name: "Citykart Stores" }];

interface LoginResponse {
  access_token: string;
  must_change_password: boolean;
  role: string;
  company_id: number;
}

function LoginPage() {
  const setAuth = useAuthStore((s) => s.setAuth);

  async function handleLogin(values: { companyId: number; empCode: string; password: string }) {
    const result = await apiClient.post<LoginResponse>("/auth/login", {
      company_id: values.companyId,
      emp_code: values.empCode,
      password: values.password,
    });
    setAuth({
      accessToken: result.access_token,
      role: result.role,
      companyId: result.company_id,
      mustChangePassword: result.must_change_password,
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <img src="/logo.png" alt="CityKart Asset Management" className="h-16 w-auto" />
      <LoginForm companies={companies} onSubmit={handleLogin} />
    </main>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LoginPage />
    </QueryClientProvider>
  );
}

export default App;
