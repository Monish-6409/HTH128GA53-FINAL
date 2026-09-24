/** Shared, browser-safe types for the multi-agent coordination layer. */

export type AgentName = "logistics" | "medical" | "communications";

export const AGENTS: { key: AgentName; label: string; brief: string }[] = [
  {
    key: "logistics",
    label: "Logistics Agent",
    brief:
      "Routing, transport, boats, fuel, shelter capacity, supply chain and resource movement under flood conditions.",
  },
  {
    key: "medical",
    label: "Medical Agent",
    brief:
      "Triage, casualty care, vulnerable persons, medication and hospital / ambulance capacity.",
  },
  {
    key: "communications",
    label: "Communications Agent",
    brief:
      "Public messaging, inter-agency coordination, alerts to affected people and press/command briefing lines.",
  },
];

/** The ONLY thing agents share with each other — no hidden chain-of-thought. */
export interface AgentStructuredOutput {
  findings: string[];
  recommendations: string[];
  resource_requirements: { item: string; quantity: string; zone?: string }[];
  priority: "critical" | "high" | "moderate" | "low";
  conflicts: string[];
  reasoning_summary: string;
}

export const EMPTY_OUTPUT: AgentStructuredOutput = {
  findings: [],
  recommendations: [],
  resource_requirements: [],
  priority: "moderate",
  conflicts: [],
  reasoning_summary: "",
};
