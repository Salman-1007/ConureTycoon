import React, { useState } from 'react';
import { GitBranch, ShieldCheck, UserCheck } from 'lucide-react';
import type { PedigreeTreeNode } from '@shared/genetics/pedigree';
import { getMutationMeta } from '@shared/genetics/catalog';

interface PedigreeTreeProps {
  tree: PedigreeTreeNode;
}

export function PedigreeTree({ tree }: PedigreeTreeProps) {
  const [inspected, setInspected] = useState<PedigreeTreeNode>(tree);

  const NodeButton = ({ node, roleLabel }: { node: PedigreeTreeNode | null; roleLabel: string }) => {
    if (!node) {
      return (
        <div className="rounded-lg border border-dashed border-[#C8922A]/25 bg-[#121914]/60 px-3 py-2 text-left opacity-65">
          <div className="text-[10px] uppercase tracking-wider text-[#7D8F7F]">{roleLabel}</div>
          <div className="text-xs italic text-[#7D8F7F]">Foundation / Unknown</div>
        </div>
      );
    }

    const isSelected = inspected.id === node.id;
    const meta = getMutationMeta(node.visualPhenotype);
    return (
      <button
        type="button"
        onClick={() => setInspected(node)}
        className={`w-full rounded-lg border px-3 py-2 text-left transition-all ${
          isSelected
            ? 'border-[#E8B84B] bg-[#2B3D30] shadow-md ring-1 ring-[#E8B84B]/50'
            : 'border-[#C8922A]/30 bg-[#18231B] hover:border-[#E8B84B]/60 hover:bg-[#213025]'
        }`}
      >
        <div className="flex items-center justify-between gap-1 text-[10px] uppercase tracking-wider text-[#9EB09F]">
          <span>{roleLabel}</span>
          <span className={node.sex === 'MALE' ? 'text-sky-300 font-bold' : 'text-rose-300 font-bold'}>
            {node.sex === 'MALE' ? '♂ ZZ' : '♀ ZW'}
          </span>
        </div>
        <div className="mt-0.5 truncate text-xs font-bold text-[#F6EFE2]">{node.name}</div>
        <div className="truncate text-[11px] font-semibold" style={{ color: meta.accentHex }}>
          {node.phenotypeName}
        </div>
        <div className="font-mono-num mt-0.5 text-[10px] text-[#9EB09F]">{node.legBand}</div>
      </button>
    );
  };

  const inspectedMeta = getMutationMeta(inspected.visualPhenotype);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-[#9EB09F]">
        <GitBranch className="h-4 w-4 text-[#E8B84B]" />
        <span>3-Generation Pedigree — Click any ancestor node to inspect its breeder & confirmed genetics.</span>
      </div>

      {/* 3-Column Horizontal Tree */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 items-center">
        {/* Column 1: Subject */}
        <div className="space-y-2">
          <NodeButton node={tree} roleLabel="Subject (Gen 0)" />
        </div>

        {/* Column 2: Parents */}
        <div className="space-y-3">
          <NodeButton node={tree.father} roleLabel="Sire (Father)" />
          <NodeButton node={tree.mother} roleLabel="Dam (Mother)" />
        </div>

        {/* Column 3: Grandparents */}
        <div className="space-y-2">
          <NodeButton node={tree.father?.father ?? null} roleLabel="Paternal Grand-Sire" />
          <NodeButton node={tree.father?.mother ?? null} roleLabel="Paternal Grand-Dam" />
          <NodeButton node={tree.mother?.father ?? null} roleLabel="Maternal Grand-Sire" />
          <NodeButton node={tree.mother?.mother ?? null} roleLabel="Maternal Grand-Dam" />
        </div>
      </div>

      {/* Selected Ancestor Inspection Panel */}
      <div className="rounded-xl border border-[#C8922A]/40 bg-[#141D17] p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="studio-frame h-14 w-16 shrink-0 overflow-hidden rounded-lg">
            <img
              src={`/assets/conures/${inspectedMeta.assetFile}`}
              alt={inspected.phenotypeName}
              className="h-full w-full object-contain p-1"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-[#F6EFE2]">{inspected.name}</span>
              <span className="font-mono-num rounded bg-[#233227] px-2 py-0.5 text-[11px] text-[#E8B84B]">
                {inspected.legBand}
              </span>
              <span className="text-xs text-[#9EB09F]">Gen {inspected.generationDepth}</span>
            </div>
            <div className="text-xs font-semibold text-[#E8B84B]">{inspected.phenotypeName} ({inspectedMeta.chromosomeLabel})</div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-[#9EB09F]">
              <UserCheck className="h-3.5 w-3.5 text-[#E8B84B]" />
              <span>Breeder of Record: <strong className="text-[#F6EFE2]">{inspected.originalBreederName}</strong></span>
            </div>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {inspected.visibleSplits.length > 0 ? (
            inspected.visibleSplits.map((s) => (
              <span
                key={s.geneKey}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-200"
              >
                <ShieldCheck className="h-3 w-3" />
                {s.label} ({s.visibility})
              </span>
            ))
          ) : (
            <span className="text-[11px] text-[#7D8F7F]">No confirmed or inferred splits visible for your discovery state.</span>
          )}
        </div>
      </div>
    </div>
  );
}
