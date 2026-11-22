"use client";

import { AnalysisScreen } from "@/components/cpv/analysis-screen";
import { DnaScreen } from "@/components/cpv/dna-screen";
import { EditorScreen } from "@/components/cpv/editor-screen";
import { HomeScreen } from "@/components/cpv/home-screen";
import { UploadScreen } from "@/components/cpv/upload-screen";
import { useCPVStore } from "@/stores/cpv-store";

export function CPVApp() {
  const step = useCPVStore((state) => state.step);

  if (step === "home") return <HomeScreen />;
  if (step === "analyzing") return <AnalysisScreen />;
  if (step === "dna") return <DnaScreen />;
  if (step === "editor") return <EditorScreen />;
  return <UploadScreen />;
}
