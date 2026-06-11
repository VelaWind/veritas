import { SimulationForm } from "@/components/admin/SimulationForm";

export const metadata = { title: "Admin · New simulation" };

export default function NewSimulationPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-xl font-light text-ink">New simulation</h1>
      <SimulationForm />
    </div>
  );
}
