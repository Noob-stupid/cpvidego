import { cn } from "@/lib/utils";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex size-8 items-center justify-center rounded-md bg-[#161616]">
        <span className="text-[11px] font-bold tracking-tight text-white">CP</span>
        <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-[#d9482b]" />
      </div>
      {!compact && (
        <div className="leading-none">
          <div className="text-[15px] font-semibold tracking-tight text-[#161616]">CPvidego</div>
          <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.2em] text-[#8a857b]">
            Beat Edit Engine
          </div>
        </div>
      )}
    </div>
  );
}

export function StepPill({ active, done, children }: { active?: boolean; done?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-2 text-[11px] transition-colors",
        active
          ? "border-[#161616] text-[#161616]"
          : done
            ? "border-transparent text-[#8a857b]"
            : "border-transparent text-[#b0aaa0]",
      )}
    >
      {active && <span className="size-1.5 rounded-full bg-[#d9482b]" />}
      {done && <span className="size-1.5 rounded-full bg-[#161616]" />}
      {children}
    </div>
  );
}
