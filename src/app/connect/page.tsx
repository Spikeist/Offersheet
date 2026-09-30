import type { Metadata } from "next";
import { ConnectFlow } from "@/components/connect/ConnectFlow";

export const metadata: Metadata = {
  title: "Connect your league",
  description: "Connect your ESPN or Sleeper fantasy football league to Offer Sheet. Read-only.",
};

export default function ConnectPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Connect your league</h1>
        <p className="mt-2 max-w-2xl text-muted">Pick your platform. Offer Sheet only reads your league: it never sends offers or changes anything.</p>
      </header>
      <ConnectFlow />
    </div>
  );
}
