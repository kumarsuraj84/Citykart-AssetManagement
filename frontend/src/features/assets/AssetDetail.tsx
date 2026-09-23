import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { actionsFor, type ActionDef } from "./actionRules";
import { Timeline, type AssetEvent } from "./Timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface Asset {
  id: number;
  asset_code: string;
  description: string;
  status: string;
}

interface HolderOption {
  id: number;
  name: string;
}

interface ActionFormState {
  holderId: string;
  eventDate: string;
  referenceNo: string;
  remarks: string;
}

const emptyActionForm: ActionFormState = {
  holderId: "",
  eventDate: new Date().toISOString().slice(0, 10),
  referenceNo: "",
  remarks: "",
};

export function AssetDetail({ assetId }: { assetId: number }) {
  const qc = useQueryClient();
  const [activeAction, setActiveAction] = useState<ActionDef | null>(null);
  const [form, setForm] = useState<ActionFormState>(emptyActionForm);

  const { data: asset } = useQuery({
    queryKey: ["assets", assetId],
    queryFn: () => apiClient.get<Asset>(`/assets/${assetId}`),
  });
  const { data: events = [] } = useQuery({
    queryKey: ["assets", assetId, "events"],
    queryFn: () => apiClient.get<AssetEvent[]>(`/assets/${assetId}/events`),
  });
  // Fetched unconditionally (not gated on a dialog being open) so the holder <select> already
  // has its options by the time an action dialog needing a holder is opened.
  const { data: holders = [] } = useQuery({
    queryKey: ["holders", "all"],
    queryFn: () => apiClient.get<HolderOption[]>("/holders"),
  });

  function setField<K extends keyof ActionFormState>(key: K, value: ActionFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openAction(action: ActionDef) {
    setForm(emptyActionForm);
    setActiveAction(action);
  }

  function closeAction() {
    setActiveAction(null);
    setForm(emptyActionForm);
  }

  const actMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/assets/${assetId}/events`, {
        event_type: activeAction!.eventType,
        to_holder_id: activeAction!.needsHolder && form.holderId ? Number(form.holderId) : null,
        event_date: form.eventDate ? new Date(form.eventDate).toISOString() : undefined,
        reference_no: form.referenceNo || null,
        remarks: form.remarks || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets", assetId] });
      qc.invalidateQueries({ queryKey: ["assets", assetId, "events"] });
      closeAction();
    },
  });

  const canConfirm = !activeAction?.needsHolder || form.holderId !== "";

  if (!asset) return null;

  const actions = actionsFor(asset.status);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col gap-1">
              <CardTitle className="font-mono text-lg">{asset.asset_code}</CardTitle>
              <p className="text-sm text-muted-foreground">{asset.description}</p>
            </div>
            <Badge>{asset.status.replace(/_/g, " ")}</Badge>
          </div>
          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => (
                <Button key={a.eventType + a.label} variant="secondary" onClick={() => openAction(a)}>
                  {a.label}
                </Button>
              ))}
            </div>
          )}
        </CardHeader>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardContent className="pt-6">
              <p>{asset.description}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="pt-6">
              <Timeline events={events} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Documents (Task 21)</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={activeAction !== null} onOpenChange={(open) => !open && closeAction()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{activeAction?.label}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {activeAction?.needsHolder && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="holder-select">Holder</Label>
                <select
                  id="holder-select"
                  aria-label="Holder"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={form.holderId}
                  onChange={(e) => setField("holderId", e.target.value)}
                >
                  <option value="">Select…</option>
                  {holders.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-date">Date</Label>
              <Input
                id="event-date"
                aria-label="Date"
                type="date"
                value={form.eventDate}
                onChange={(e) => setField("eventDate", e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reference-no">Reference No</Label>
              <Input
                id="reference-no"
                aria-label="Reference No"
                value={form.referenceNo}
                onChange={(e) => setField("referenceNo", e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="remarks">Remarks</Label>
              <Textarea
                id="remarks"
                aria-label="Remarks"
                value={form.remarks}
                onChange={(e) => setField("remarks", e.target.value)}
              />
            </div>

            {actMutation.isError && (
              <p className="text-sm text-destructive">
                {actMutation.error instanceof Error ? actMutation.error.message : "Failed to record event."}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeAction}>
              Cancel
            </Button>
            <Button onClick={() => actMutation.mutate()} disabled={!canConfirm || actMutation.isPending}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
