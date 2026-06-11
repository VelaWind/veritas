import { DomainForm } from "@/components/admin/DomainForm";

export const metadata = { title: "Admin · New domain" };

export default function NewDomainPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-xl font-light text-ink">New domain</h1>
      <DomainForm />
    </div>
  );
}
