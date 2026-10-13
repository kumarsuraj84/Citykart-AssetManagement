import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiClient, ApiError, errorMessageFrom } from "./api-client";
import { authFetch } from "./auth-fetch";

vi.mock("./auth-fetch", () => ({ authFetch: vi.fn() }));

function respond(status: number, body: unknown, rawText?: string) {
  (authFetch as any).mockResolvedValue(
    new Response(rawText ?? JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

async function failure(): Promise<ApiError> {
  try {
    await apiClient.post("/x", {});
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("expected the request to fail");
}

beforeEach(() => vi.clearAllMocks());

describe("apiClient errors (S0 contract)", () => {
  it("a validation 422 shows the server's one readable sentence, not 'Request failed: 422'", async () => {
    respond(422, { detail: "PO number is required. Line 3: Quantity must be at least 1.", errors: ["PO number is required.", "Line 3: Quantity must be at least 1."] });
    const e = await failure();
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(422);
    expect(e.message).toBe("PO number is required. Line 3: Quantity must be at least 1.");
  });

  it("S4: the parsed body rides along on the error (a refused receipt's structured problems)", async () => {
    const problems = [{ line_no: 1, unit_index: 2, serial: "B", message: "Serial number B is typed more than once." }];
    respond(422, { detail: "Nothing was received: 1 problem needs fixing.", errors: ["Line 1: …"], problems });
    const e = await failure();
    expect(e.message).toBe("Nothing was received: 1 problem needs fixing.");
    expect((e.body as { problems: unknown }).problems).toEqual(problems);
    respond(500, null, "not json");
    expect((await failure()).body).toBeNull();
  });

  it.each([
    [409, "A record with this code already exists."],
    [422, "The vendor you chose does not exist."],
    [503, "The database could not be reached. Try again in a moment."],
    [403, "Only a head-office admin can change a head-office admin account."],
  ])("a %s answer keeps its sentence", async (status, detail) => {
    respond(status, { detail });
    const e = await failure();
    expect(e.message).toBe(detail);
    expect(e.status).toBe(status);
  });

  it("joins the errors list when detail is missing", async () => {
    respond(422, { errors: ["Name is required.", "Code is too long (max 20 characters).", "Name is required."] });
    expect((await failure()).message).toBe("Name is required. Code is too long (max 20 characters).");
  });

  it("still understands the old array-of-objects detail", async () => {
    respond(422, { detail: [{ loc: ["body", "name"], msg: "Field required", type: "missing" }, { loc: ["body", "code"], msg: "Field required", type: "missing" }] });
    expect((await failure()).message).toBe("Field required");
    respond(422, { detail: [{ loc: ["body", "name"], msg: "Field required" }, { loc: ["body", "code"], msg: "Value is not valid" }] });
    expect((await failure()).message).toBe("Field required Value is not valid");
  });

  it("falls back to the status code only when the body has nothing readable", async () => {
    respond(500, null, "<html>oops</html>");
    expect((await failure()).message).toBe("Request failed: 500");
    respond(502, {});
    expect((await failure()).message).toBe("Request failed: 502");
    respond(422, { detail: [{ loc: [], type: "x" }] });
    expect((await failure()).message).toBe("Request failed: 422");
  });

  it("errorMessageFrom handles odd shapes without throwing", () => {
    expect(errorMessageFrom(null, 400)).toBe("Request failed: 400");
    expect(errorMessageFrom("text", 400)).toBe("Request failed: 400");
    expect(errorMessageFrom({ detail: "  " }, 400)).toBe("Request failed: 400");
    expect(errorMessageFrom({ detail: { message: "Nested sentence." } }, 400)).toBe("Nested sentence.");
    expect(errorMessageFrom({ detail: "Plain.", errors: ["Other."] }, 400)).toBe("Plain.");
  });

  it("successful and 204 responses are unchanged", async () => {
    respond(200, { ok: true });
    await expect(apiClient.get("/x")).resolves.toEqual({ ok: true });
    (authFetch as any).mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiClient.delete("/x")).resolves.toBeUndefined();
  });

  it("S2: getPage returns the rows and the X-Total-Count total (null when the header is missing)", async () => {
    (authFetch as any).mockResolvedValue(
      new Response(JSON.stringify([{ id: 1 }]), { status: 200, headers: { "Content-Type": "application/json", "X-Total-Count": "412" } }),
    );
    await expect(apiClient.getPage("/purchase-orders?limit=1")).resolves.toEqual({ data: [{ id: 1 }], total: 412 });
    respond(200, []);
    await expect(apiClient.getPage("/purchase-orders")).resolves.toEqual({ data: [], total: null });
    respond(409, { detail: "Not allowed." });
    await expect(apiClient.getPage("/purchase-orders")).rejects.toMatchObject({ status: 409, message: "Not allowed." });
  });
});
