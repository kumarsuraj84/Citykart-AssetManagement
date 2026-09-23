import { MasterCrudScreen } from "../../components/master-crud/MasterCrudScreen";

interface CustomField {
  id: number;
  field_key: string;
  label: string;
  field_type: string;
  is_required: boolean;
  sort_order: number;
}

const FIELD_TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "dropdown", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
];

export default function CustomFieldsSetup() {
  return (
    <MasterCrudScreen<CustomField>
      config={{
        resource: "custom-fields",
        title: "Custom Fields",
        columns: [
          { key: "field_key", label: "Field Key" },
          { key: "label", label: "Label" },
          { key: "field_type", label: "Type" },
          { key: "is_required", label: "Required" },
          { key: "sort_order", label: "Sort Order" },
        ],
        formFields: [
          { key: "field_key", label: "Field Key" },
          { key: "label", label: "Label" },
          { key: "field_type", label: "Field Type", type: "select", options: FIELD_TYPE_OPTIONS },
          { key: "is_required", label: "Required", type: "checkbox" },
          { key: "sort_order", label: "Sort Order", type: "number" },
        ],
      }}
    />
  );
}
