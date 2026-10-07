import type { Metadata } from "next";
import { Workspace } from "@/components/workspace";

export const metadata: Metadata = {
  title: "Process shipping labels",
  alternates: { canonical: "/app" },
  robots: { index: false, follow: false },
};

export default function AppPage() {
  return <Workspace />;
}
