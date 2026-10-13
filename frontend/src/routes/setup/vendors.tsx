import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";
import type { FormField } from "../../components/master-crud/types";
import { ErpVendorsDialog } from "../../features/vendors/ErpVendorsDialog";
import { gstinProblem } from "../../lib/gstin";

interface Vendor {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  /** One supplier code per company: the same code is a different supplier in each company's ERP. */
  erp_links: { company_id: number; company_code: string; erp_vendor_code: string }[];
}

const linksText = (value: unknown) =>
  (Array.isArray(value) ? (value as Vendor["erp_links"]) : []).map((l) => `${l.company_code} ${l.erp_vendor_code}`).join(" · ");

const text = (raw: unknown) => (typeof raw === "string" ? raw.trim() : "");
/** Blank optional text is sent as null (cleared). */
const orNull = (raw: unknown) => (text(raw) === "" ? null : text(raw));

const NAME: FormField = { key: "name", label: "Name", required: true, placeholder: "Vansh Enterprises Pvt. Ltd." };
const GSTIN: FormField = {
  key: "gstin", label: "GSTIN", placeholder: "07ABCDE1234F1Z5", helperText: "Optional.",
  validate: gstinProblem, toPayload: (raw) => (text(raw) === "" ? null : text(raw).toUpperCase()),
};
const CONTACTS: FormField[] = [
  { key: "contact_name", label: "Contact Name", toPayload: orNull },
  { key: "contact_phone", label: "Contact Phone", toPayload: orNull },
  { key: "contact_email", label: "Contact Email", toPayload: orNull },
];

/**
 * Settings › Vendors (S3b-2): add a vendor with just its name (and GSTIN when known); contacts and an optional code
 * under More. A blank code is never sent: the server makes one from the name. The code cannot change later.
 */
export default function VendorsSetup({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <MasterCrudScreen<Vendor>
      embedded={embedded}
      extraActions={<ErpVendorsDialog />}
      config={{
        resource: "vendors",
        title: "Vendors",
        singular: "Vendor",
        columns: [
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "gstin", label: "GSTIN" },
          { key: "contact_name", label: "Contact" },
          { key: "erp_links", label: "ERP codes", format: linksText },
        ],
        formFields: [
          NAME,
          GSTIN,
          ...CONTACTS.map((f) => ({ ...f, more: true })),
          {
            key: "code", label: "Code", more: true, helperText: "Optional. Made from the name when left blank; it cannot be changed later.",
            toPayload: (raw) => (text(raw) === "" ? undefined : text(raw)),
          },
        ],
        editFields: [NAME, GSTIN, ...CONTACTS],
      }}
    />
  );
}
