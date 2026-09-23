import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AssetRow {
  id: number;
  asset_code: string;
  description: string;
  status: string;
}

export function MyAssets() {
  const { data } = useQuery({
    queryKey: ["assets", "mine"],
    queryFn: () => apiClient.get<{ items: AssetRow[]; total: number }>("/assets"),
  });
  const items = data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>My Assets</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <a href={`/assets/${a.id}`} className="text-blue-600 hover:underline font-mono">
                      {a.asset_code}
                    </a>
                  </TableCell>
                  <TableCell>{a.description}</TableCell>
                  <TableCell>
                    <Badge>{a.status.replace(/_/g, " ")}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
