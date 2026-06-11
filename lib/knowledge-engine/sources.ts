import type { SourceType } from "@/types/domain";

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  peer_reviewed: "Peer-reviewed",
  preprint: "Preprint",
  book: "Book",
  dataset: "Dataset",
  experiment: "Experiment",
  observation: "Observation",
  simulation_result: "Simulation result",
  philosophical_argument: "Philosophical argument",
  mathematical_proof: "Mathematical proof",
  other: "Other",
};

export const SOURCE_TYPES = Object.keys(SOURCE_TYPE_LABELS) as SourceType[];
