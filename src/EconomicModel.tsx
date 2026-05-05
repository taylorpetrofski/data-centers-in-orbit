/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Economic Viability Model — Data Centers in Orbit
 * Interactive model for CS 4501 final project
 */
 
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, Info, BarChart2, Sliders, Zap } from 'lucide-react';
 
// ─── Types ────────────────────────────────────────────────────────────────────
 
interface SliderParam {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  unitPrefix?: boolean;
  citation: string;
  citationUrl: string;
  description: string;
  format?: (v: number) => string;
}
 
type Scenario = 'pessimistic' | 'current' | 'optimistic';
 
// ─── Constants ────────────────────────────────────────────────────────────────
 
const SCENARIO_PRESETS: Record<Scenario, Record<string, number>> = {
  pessimistic: {
    launchCost: 2500,
    earthEnergy: 0.06,
    computeDoublingYears: 3.5,
    hardwareLifespan: 4,
    regulationCost: 18,
    solarEfficiency: 28,
    launchCostDeclineRate: 5,
  },
  current: {
    launchCost: 1500,
    earthEnergy: 0.085,
    computeDoublingYears: 2.5,
    hardwareLifespan: 6,
    regulationCost: 12,
    solarEfficiency: 35,
    launchCostDeclineRate: 12,
  },
  optimistic: {
    launchCost: 500,
    earthEnergy: 0.12,
    computeDoublingYears: 1.8,
    hardwareLifespan: 8,
    regulationCost: 6,
    solarEfficiency: 45,
    launchCostDeclineRate: 22,
  },
};
 
const SCENARIO_LABELS: Record<Scenario, string> = {
  pessimistic: 'Pessimistic 2025',
  current: 'Current 2025',
  optimistic: 'Optimistic 2030',
};
 
// ─── Model Logic ──────────────────────────────────────────────────────────────
 
/**
 * Computes levelized cost of compute ($/PFLOP-day) for both earth and space
 * over a multi-year horizon and returns year-by-year data.
 *
 * Earth TCO: (energy cost + land/cooling + regulation overhead) per unit compute
 * Space TCO: (amortized launch + hardware replacement) per unit compute,
 *             offset by solar advantage and no cooling cost
 *
 * Sources for formula structure:
 *   - Starcloud white paper (starcloudinc.github.io/wp.pdf)
 *   - Ars Technica orbital data centers series (March 2026)
 *   - MIT Technology Review "Four things we'd need" (April 2026)
 */
function computeModel(params: Record<string, number>, years: number = 10) {
  const {
    launchCost,         // $/kg to LEO
    earthEnergy,        // $/kWh on earth
    computeDoublingYears,
    hardwareLifespan,   // years before hardware obsolete in orbit
    regulationCost,     // earth regulatory/compliance overhead %
    solarEfficiency,    // % of theoretical solar harvest actually usable
    launchCostDeclineRate, // % per year launch cost falls (compounding)
  } = params;
 
  // Fixed assumptions (sourced)
  const HW_KG_PER_PFLOP = 0.8;          // kg of hardware per PFLOP; Starcloud WP
  const EARTH_ENERGY_KWH_PER_PFLOP_DAY = 2.4; // kWh; Pew Research / IEA 2025
  const SPACE_SOLAR_KW_PER_KG = 0.15;   // kW solar per kg of panel mass; ESA estimates
  const EARTH_PUE = 1.5;                // Power Usage Effectiveness; Uptime Inst. 2024
  const EARTH_LAND_COOLING_PER_PFLOP_DAY = 0.0012; // $/PFLOP-day; UMich STPP 2025
  const SPACE_LAUNCH_STRUCT_RATIO = 1.4; // structural/thermal overhead multiplier on HW mass
  const SPACE_OPS_ANNUAL = 0.08;        // annual ops cost as % of hardware cost (no physical access)
  const HW_COST_PER_KG = 8000;         // $/kg of compute hardware (GPU density); industry est.
  const SPACE_LATENCY_PENALTY = 0.04;  // 4% cost penalty for latency-sensitive workloads
 
  const results = [];
 
  for (let year = 0; year <= years; year++) {
    // Launch cost falls each year due to Starship + competition
    const launchCostYear = launchCost * Math.pow(1 - launchCostDeclineRate / 100, year);
 
    // Earth energy prices trend upward ~3%/yr (EIA projection)
    const earthEnergyYear = earthEnergy * Math.pow(1.03, year);
 
    // Compute efficiency improves (hardware does more per kg over time)
    const computeMultiplier = Math.pow(2, year / computeDoublingYears);
 
    // ── Earth TCO ($/PFLOP-day) ──
    const earthEnergyCost = EARTH_ENERGY_KWH_PER_PFLOP_DAY * earthEnergyYear * EARTH_PUE;
    const earthRegCost = (earthEnergyCost + EARTH_LAND_COOLING_PER_PFLOP_DAY) * (regulationCost / 100);
    const earthTotal = (earthEnergyCost + EARTH_LAND_COOLING_PER_PFLOP_DAY + earthRegCost) / computeMultiplier;
 
    // ── Space TCO ($/PFLOP-day) ──
    // Hardware mass + structural overhead
    const massPerPflop = (HW_KG_PER_PFLOP * SPACE_LAUNCH_STRUCT_RATIO) / computeMultiplier;
    // Amortize launch + hardware cost over lifespan (days)
    const lifespanDays = hardwareLifespan * 365;
    const launchHwCostPerPflopDay =
      (massPerPflop * launchCostYear + (HW_KG_PER_PFLOP * HW_COST_PER_KG) / computeMultiplier) / lifespanDays;
    // Solar energy: free generation, but panels cost mass to launch
    const solarPanelMassPerKflop = 0.05 / computeMultiplier; // panels per PFLOP
    const solarLaunchCost = solarPanelMassPerKflop * launchCostYear;
    const solarEnergyCost = solarLaunchCost / lifespanDays; // amortized
    const spaceOpsCost = launchHwCostPerPflopDay * SPACE_OPS_ANNUAL;
    const solarEfficiencyFactor = solarEfficiency / 100;
    const spaceEnergyAdjust = (1 - solarEfficiencyFactor * 0.4); // partial solar offset
    const spaceTotal =
      (launchHwCostPerPflopDay + solarEnergyCost + spaceOpsCost) *
      spaceEnergyAdjust +
      SPACE_LATENCY_PENALTY * earthTotal;
 
    // Cost ratio < 1 means space is cheaper
    const ratio = spaceTotal / earthTotal;
 
    results.push({
      year: 2025 + year,
      earthTotal: Math.max(0.0001, earthTotal),
      spaceTotal: Math.max(0.0001, spaceTotal),
      ratio,
      launchCostYear,
      viable: ratio < 1,
    });
  }
 
  return results;
}
 
/**
 * Sensitivity analysis: vary each param ±20% from baseline,
 * return how much the year-5 space/earth ratio changes.
 */
function computeSensitivity(params: Record<string, number>) {
  const baseResults = computeModel(params, 10);
  const baseRatio = baseResults[5].ratio;
  const DELTA = 0.20;
 
  const paramLabels: Record<string, string> = {
    launchCost: 'Launch cost ($/kg)',
    earthEnergy: 'Earth energy price',
    computeDoublingYears: 'Compute doubling time',
    hardwareLifespan: 'Hardware lifespan',
    regulationCost: 'Regulation overhead',
    solarEfficiency: 'Solar efficiency',
    launchCostDeclineRate: 'Launch cost decline rate',
  };
 
  return Object.keys(params).map((key) => {
    const highParams = { ...params, [key]: params[key] * (1 + DELTA) };
    const lowParams = { ...params, [key]: params[key] * (1 - DELTA) };
    const highRatio = computeModel(highParams, 10)[5].ratio;
    const lowRatio = computeModel(lowParams, 10)[5].ratio;
    const swing = Math.abs(highRatio - lowRatio);
    const direction = highRatio > baseRatio ? 'increases' : 'decreases';
    return {
      key,
      label: paramLabels[key] || key,
      swing,
      baseRatio,
      highRatio,
      lowRatio,
      direction,
    };
  }).sort((a, b) => b.swing - a.swing);
}
 
// ─── Sub-components ───────────────────────────────────────────────────────────
 
const InfoTooltip = ({ text, url }: { text: string; url: string }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
 
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
 
  return (
    <div ref={ref} className="relative inline-block ml-2 align-middle">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-4 h-4 rounded-full border border-deep-teal/40 flex items-center justify-center text-[9px] font-mono font-bold text-deep-teal/60 hover:border-atomic-orange hover:text-atomic-orange transition-colors"
        aria-label="Source info"
      >
        i
      </button>
      {open && (
        <div className="absolute left-6 top-0 z-50 w-64 bg-white border-2 border-deep-teal shadow-[4px_4px_0px_0px_rgba(13,71,78,1)] p-3 text-[11px] text-deep-teal leading-relaxed">
          <p className="mb-2">{text}</p>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-atomic-orange underline font-bold break-all"
          >
            View source →
          </a>
        </div>
      )}
    </div>
  );
};
 
const SliderRow = ({
  param,
  onChange,
}: {
  param: SliderParam;
  onChange: (id: string, val: number) => void;
}) => {
  const displayVal = param.format
    ? param.format(param.value)
    : param.unitPrefix
    ? `${param.unit}${param.value.toLocaleString()}`
    : `${param.value.toLocaleString()}${param.unit}`;
 
  return (
    <div className="border-b border-deep-teal/10 pb-4 last:border-0 last:pb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-deep-teal uppercase tracking-tight flex items-center">
          {param.label}
          <InfoTooltip text={param.citation} url={param.citationUrl} />
        </span>
        <span className="text-xs font-mono font-bold text-atomic-orange bg-atomic-orange/10 px-2 py-0.5">
          {displayVal}
        </span>
      </div>
      <p className="text-[10px] text-deep-teal/50 mb-2 font-mono">{param.description}</p>
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={param.step}
        value={param.value}
        onChange={(e) => onChange(param.id, parseFloat(e.target.value))}
        className="w-full h-1.5 appearance-none bg-deep-teal/20 rounded-none cursor-pointer accent-atomic-orange"
        style={{ accentColor: '#E85D04' }}
      />
      <div className="flex justify-between text-[9px] font-mono text-deep-teal/30 mt-0.5">
        <span>
          {param.unitPrefix ? `${param.unit}${param.min.toLocaleString()}` : `${param.min.toLocaleString()}${param.unit}`}
        </span>
        <span>
          {param.unitPrefix ? `${param.unit}${param.max.toLocaleString()}` : `${param.max.toLocaleString()}${param.unit}`}
        </span>
      </div>
    </div>
  );
};
 
// Simple canvas-based line chart (no external deps)
const CostChart = ({
  data,
}: {
  data: ReturnType<typeof computeModel>;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
 
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
 
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
 
    const W = rect.width;
    const H = rect.height;
    const PAD = { top: 16, right: 20, bottom: 36, left: 58 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;
 
    ctx.clearRect(0, 0, W, H);
 
    const allVals = data.flatMap((d) => [d.earthTotal, d.spaceTotal]);
    const maxVal = Math.max(...allVals) * 1.15;
    const minVal = 0;
 
    const xScale = (i: number) => PAD.left + (i / (data.length - 1)) * chartW;
    const yScale = (v: number) => PAD.top + chartH - ((v - minVal) / (maxVal - minVal)) * chartH;
 
    // Grid lines
    ctx.strokeStyle = 'rgba(13,71,78,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(W - PAD.right, y);
      ctx.stroke();
      const val = maxVal - (maxVal / 4) * i;
      ctx.fillStyle = 'rgba(13,71,78,0.4)';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`$${val.toFixed(4)}`, PAD.left - 4, y + 3);
    }
 
    // X axis labels
    ctx.fillStyle = 'rgba(13,71,78,0.4)';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    data.forEach((d, i) => {
      if (i % 2 === 0) {
        ctx.fillText(String(d.year), xScale(i), H - PAD.bottom + 16);
      }
    });
 
    // Viability shading
    let inViableZone = false;
    let startX = 0;
    data.forEach((d, i) => {
      if (d.viable && !inViableZone) {
        startX = xScale(i);
        inViableZone = true;
      } else if (!d.viable && inViableZone) {
        ctx.fillStyle = 'rgba(13,71,78,0.06)';
        ctx.fillRect(startX, PAD.top, xScale(i) - startX, chartH);
        inViableZone = false;
      }
    });
    if (inViableZone) {
      ctx.fillStyle = 'rgba(13,71,78,0.06)';
      ctx.fillRect(startX, PAD.top, xScale(data.length - 1) - startX, chartH);
    }
 
    // Earth line
    ctx.beginPath();
    ctx.strokeStyle = '#0D474E';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);
    data.forEach((d, i) => {
      const x = xScale(i);
      const y = yScale(d.earthTotal);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
 
    // Space line
    ctx.beginPath();
    ctx.strokeStyle = '#E85D04';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 3]);
    data.forEach((d, i) => {
      const x = xScale(i);
      const y = yScale(d.spaceTotal);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
 
    // Crossover marker
    const crossIdx = data.findIndex((d) => d.viable);
    if (crossIdx > 0) {
      const x = xScale(crossIdx);
      ctx.strokeStyle = '#E4A725';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, PAD.top + chartH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#E4A725';
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('VIABLE', x, PAD.top + 10);
    }
  }, [data]);
 
  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '220px', display: 'block' }}
      aria-label="Line chart showing earth vs space data center cost over 10 years"
    />
  );
};
 
// Sensitivity bar chart
const SensitivityChart = ({
  data,
}: {
  data: ReturnType<typeof computeSensitivity>;
}) => {
  const maxSwing = Math.max(...data.map((d) => d.swing));
 
  return (
    <div className="space-y-3">
      {data.map((item) => {
        const pct = (item.swing / maxSwing) * 100;
        const favorable = item.key === 'launchCostDeclineRate' || item.key === 'solarEfficiency' || item.key === 'hardwareLifespan';
        return (
          <div key={item.key}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-mono font-bold text-deep-teal uppercase tracking-tight">
                {item.label}
              </span>
              <span className="text-[10px] font-mono text-deep-teal/60">
                ±{(item.swing * 100).toFixed(1)}% ratio swing
              </span>
            </div>
            <div className="h-3 bg-deep-teal/10 w-full">
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  background: favorable ? '#0D474E' : '#E85D04',
                }}
              />
            </div>
          </div>
        );
      })}
      <div className="flex gap-6 pt-2">
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-deep-teal/60">
          <span className="w-3 h-2 inline-block" style={{ background: '#0D474E' }} />
          Helps space case
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-deep-teal/60">
          <span className="w-3 h-2 inline-block" style={{ background: '#E85D04' }} />
          Hurts space case
        </span>
      </div>
    </div>
  );
};
 
// ─── Main Page Component ──────────────────────────────────────────────────────
 
export default function EconomicModel() {
  const [activeScenario, setActiveScenario] = useState<Scenario>('current');
  const [activeTab, setActiveTab] = useState<'model' | 'sensitivity'>('model');
 
  const [params, setParams] = useState<Record<string, number>>(SCENARIO_PRESETS.current);
 
  const sliderDefs: SliderParam[] = [
    {
      id: 'launchCost',
      label: 'Launch cost to LEO',
      min: 100,
      max: 5000,
      step: 50,
      value: params.launchCost,
      unit: '/kg',
      unitPrefix: true,
      format: (v) => `$${v.toLocaleString()}/kg`,
      citation:
        'Falcon 9: ~$2,700/kg (SpaceX 2024). Starship target: ~$100/kg (Musk, 2026). Google Suncatcher needs <$200/kg by 2035.',
      citationUrl: 'https://arstechnica.com/space/2026/03/orbital-data-centers-part-1-theres-no-way-this-is-economically-viable-right/',
      description: 'Cost to lift 1 kg of payload to low Earth orbit',
    },
    {
      id: 'earthEnergy',
      label: 'Earth energy price',
      min: 0.02,
      max: 0.25,
      step: 0.005,
      value: params.earthEnergy,
      unit: '/kWh',
      format: (v) => `$${v.toFixed(3)}/kWh`,
      citation:
        'US commercial avg: $0.085/kWh (EIA 2025). Hyperscaler contracts often lower. Renewables driving cost down, grid constraints pushing up.',
      citationUrl: 'https://www.pewresearch.org/short-reads/2025/10/24/what-we-know-about-energy-use-at-us-data-centers-amid-the-ai-boom/',
      description: 'Grid electricity cost for terrestrial data centers',
    },
    {
      id: 'launchCostDeclineRate',
      label: 'Annual launch cost decline',
      min: 0,
      max: 35,
      step: 1,
      value: params.launchCostDeclineRate,
      unit: '%/yr',
      format: (v) => `${v}%/yr`,
      citation:
        'Falcon 9 dropped costs ~10x over a decade. Starship could drop another 10x. Assumed 12%/yr baseline decline mirrors historical SpaceX trajectory.',
      citationUrl: 'https://www.wired.com/story/data-centers-gobble-earths-resources-what-if-we-took-them-to-space-instead/',
      description: 'How fast launch costs fall year-over-year',
    },
    {
      id: 'computeDoublingYears',
      label: 'Compute efficiency doubling time',
      min: 1,
      max: 5,
      step: 0.1,
      value: params.computeDoublingYears,
      unit: ' yrs',
      format: (v) => `${v.toFixed(1)} yrs`,
      citation:
        'GPU FLOP/$ has doubled ~every 2-2.5 years historically (Epoch AI, 2025). Faster doubling helps both sides but favors space less since hardware refresh is harder in orbit.',
      citationUrl: 'https://www.technologyreview.com/2026/04/03/1135073/four-things-wed-need-to-put-data-centers-in-space/',
      description: 'Years for compute performance per $ to double',
    },
    {
      id: 'hardwareLifespan',
      label: 'Orbital hardware lifespan',
      min: 2,
      max: 12,
      step: 0.5,
      value: params.hardwareLifespan,
      unit: ' yrs',
      format: (v) => `${v.toFixed(1)} yrs`,
      citation:
        'Microsoft\'s Project Natick: ~5yr lifespan for submerged hardware (no repair). Cosmic radiation and temperature cycling make orbital hardware harder to sustain. Starcloud targets 7-10yr.',
      citationUrl: 'https://observer.com/2026/03/starcloud-ceo-philip-johnston-nvidia-space-data-center/',
      description: 'How long hardware operates before replacement is needed',
    },
    {
      id: 'regulationCost',
      label: 'Earth regulatory overhead',
      min: 0,
      max: 30,
      step: 1,
      value: params.regulationCost,
      unit: '%',
      format: (v) => `${v}% of OPEX`,
      citation:
        'Compliance, permitting, and regulatory costs for US hyperscale data centers estimated at 8–20% of OPEX (UMich STPP, 2025). State and local variation is large.',
      citationUrl: 'https://stpp.fordschool.umich.edu/sites/stpp/files/2025-07/stpp-data-centers-2025.pdf',
      description: 'Compliance/permitting overhead added to terrestrial costs',
    },
    {
      id: 'solarEfficiency',
      label: 'Solar harvest efficiency',
      min: 10,
      max: 60,
      step: 1,
      value: params.solarEfficiency,
      unit: '%',
      format: (v) => `${v}% usable`,
      citation:
        'LEO solar panels: 95% capacity factor vs 24% on ground (WEF 2026). But transmission losses, thermal management, and orbital night reduce effective harvest. Starcloud targets 35-45%.',
      citationUrl: 'https://www.weforum.org/stories/2026/01/data-centres-space-ai-revolution/',
      description: 'Fraction of theoretical solar irradiance actually usable',
    },
  ];
 
  const handleSliderChange = (id: string, val: number) => {
    setParams((prev) => ({ ...prev, [id]: val }));
    setActiveScenario('current'); // leave preset on manual change
  };
 
  const applyScenario = (s: Scenario) => {
    setActiveScenario(s);
    setParams(SCENARIO_PRESETS[s]);
  };
 
  const modelData = useMemo(() => computeModel(params, 10), [params]);
  const sensitivityData = useMemo(() => computeSensitivity(params), [params]);
 
  const year5 = modelData[5];
  const year10 = modelData[10];
  const breakEvenYear = modelData.find((d) => d.viable)?.year;
  const currentRatio = modelData[0].ratio;
 
  const verdict =
    currentRatio < 0.85
      ? { text: 'Space wins now', color: '#0D474E', bg: 'rgba(13,71,78,0.08)' }
      : currentRatio < 1.0
      ? { text: 'Near parity', color: '#E4A725', bg: 'rgba(228,167,37,0.1)' }
      : currentRatio < 1.5
      ? { text: 'Space trails — watch trend', color: '#E4A725', bg: 'rgba(228,167,37,0.1)' }
      : { text: 'Space unviable', color: '#E85D04', bg: 'rgba(232,93,4,0.08)' };
 
  return (
    <div className="pt-40 max-w-7xl mx-auto px-6 grainy-texture pb-32">
      {/* ── Page Header ── */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="mb-16 border-b-8 border-deep-teal pb-12 relative"
      >
        <div className="absolute -top-10 left-0 text-[10px] font-mono text-deep-teal/40 uppercase tracking-[0.4em]">
          CLASSIFICATION: DECLASSIFIED // TOPIC_ID: ECONOMIC_MODEL
        </div>
        <div className="flex flex-col md:flex-row items-start md:items-center gap-8 mb-10">
          <div className="w-24 h-24 bg-mustard/20 border-4 border-deep-teal flex items-center justify-center shadow-[6px_6px_0px_0px_rgba(13,71,78,1)]">
            <TrendingUp className="w-12 h-12 text-deep-teal" />
          </div>
          <h1 className="text-5xl md:text-8xl font-display font-black text-deep-teal uppercase italic tracking-tighter leading-none">
            Economic<br />
            <span className="text-atomic-orange">Viability</span>
          </h1>
        </div>
        <div className="bg-atomic-orange text-cream p-8 retro-border max-w-5xl">
          <p className="text-xl md:text-2xl font-bold italic leading-tight">
            Under what conditions do orbital data centers actually make economic sense? Adjust the assumptions — and watch the model tell you.
          </p>
        </div>
      </motion.div>
 
      {/* ── Methodology note ── */}
      <div className="mb-12 bg-white/60 retro-border p-6 max-w-4xl">
        <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-deep-teal/60 mb-3 flex items-center gap-2">
          <div className="w-2 h-2 bg-mustard" /> Model Methodology
        </h4>
        <p className="text-sm text-deep-teal leading-relaxed font-medium">
          This model computes the <strong>levelized cost of compute</strong> ($/PFLOP-day) for Earth-based vs. orbital data centers across a 10-year horizon. Earth TCO includes energy, cooling, land, and regulatory overhead. Space TCO includes launch amortization, hardware replacement, solar panel mass, and a latency penalty for workloads requiring low-latency. Each variable's default range is grounded in cited sources — click the <span className="font-mono text-atomic-orange">i</span> icon on any slider to see the source. The model is a simplified first-principles estimate, not a proprietary industry projection.
        </p>
      </div>
 
      {/* ── Scenario presets ── */}
      <div className="mb-10">
        <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-deep-teal/50 mb-4">
          Scenario Presets
        </div>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(SCENARIO_PRESETS) as Scenario[]).map((s) => (
            <button
              key={s}
              onClick={() => applyScenario(s)}
              className={`px-6 py-2 text-xs font-mono font-bold uppercase tracking-widest border-2 transition-all ${
                activeScenario === s
                  ? 'bg-deep-teal text-cream border-deep-teal'
                  : 'bg-transparent text-deep-teal border-deep-teal/40 hover:border-deep-teal'
              }`}
            >
              {SCENARIO_LABELS[s]}
            </button>
          ))}
        </div>
      </div>
 
      {/* ── Main Grid ── */}
      <div className="grid lg:grid-cols-[380px_1fr] gap-12 items-start">
        {/* Left: Sliders */}
        <div>
          <div className="bg-white retro-border p-6 mb-6">
            <h3 className="text-[10px] font-mono uppercase tracking-[0.3em] text-deep-teal/60 mb-5 flex items-center gap-2">
              <Sliders className="w-3 h-3" /> Adjust Assumptions
            </h3>
            <div className="space-y-5">
              {sliderDefs.map((p) => (
                <SliderRow
                  key={p.id}
                  param={{ ...p, value: params[p.id] }}
                  onChange={handleSliderChange}
                />
              ))}
            </div>
          </div>
          <div className="bg-mustard/10 border-2 border-mustard p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-mustard font-bold mb-2 flex items-center gap-2">
              <Info className="w-3 h-3" /> About this model
            </div>
            <p className="text-[11px] text-deep-teal/70 leading-relaxed">
              Hover over the <span className="font-mono text-atomic-orange font-bold">i</span> icon beside each slider for the source behind that parameter's range. All citations link to publicly available reports, whitepapers, or journalism.
            </p>
          </div>
        </div>
 
        {/* Right: Charts + Results */}
        <div className="space-y-8">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                label: 'Current space/earth ratio',
                value: currentRatio.toFixed(2) + '×',
                sub: currentRatio < 1 ? 'Space is cheaper' : 'Earth is cheaper',
                accent: currentRatio < 1,
              },
              {
                label: 'Break-even year',
                value: breakEvenYear ? String(breakEvenYear) : 'Not in range',
                sub: breakEvenYear ? 'Space becomes viable' : 'Needs bigger shifts',
                accent: !!breakEvenYear,
              },
              {
                label: 'Ratio at year 5 (2030)',
                value: year5.ratio.toFixed(2) + '×',
                sub: year5.viable ? 'Space wins' : 'Earth still cheaper',
                accent: year5.viable,
              },
              {
                label: 'Ratio at year 10 (2035)',
                value: year10.ratio.toFixed(2) + '×',
                sub: year10.viable ? 'Space wins' : 'Earth still cheaper',
                accent: year10.viable,
              },
            ].map((card) => (
              <div key={card.label} className="bg-white retro-border p-4">
                <div className="text-[9px] font-mono uppercase tracking-widest text-deep-teal/50 mb-1 leading-tight">
                  {card.label}
                </div>
                <div
                  className="text-2xl font-display font-black"
                  style={{ color: card.accent ? '#0D474E' : '#E85D04' }}
                >
                  {card.value}
                </div>
                <div className="text-[10px] font-mono text-deep-teal/60 mt-0.5">{card.sub}</div>
              </div>
            ))}
          </div>
 
          {/* Verdict banner */}
          <div
            className="border-2 border-deep-teal/20 p-4 flex items-center gap-4"
            style={{ background: verdict.bg }}
          >
            <Zap className="w-5 h-5 shrink-0" style={{ color: verdict.color }} />
            <div>
              <span
                className="text-xs font-mono font-bold uppercase tracking-widest"
                style={{ color: verdict.color }}
              >
                {verdict.text}
              </span>
              <span className="text-xs text-deep-teal/60 font-mono ml-3">
                — at current assumptions, space costs{' '}
                <strong>{(currentRatio * 100 - 100).toFixed(0)}%</strong>
                {currentRatio >= 1 ? ' more' : ' less'} per PFLOP-day than Earth
              </span>
            </div>
          </div>
 
          {/* Tab bar */}
          <div className="border-b-2 border-deep-teal/20 flex gap-0">
            {[
              { id: 'model' as const, label: '10-Year Cost Trajectory', icon: BarChart2 },
              { id: 'sensitivity' as const, label: 'Sensitivity Analysis', icon: Sliders },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`px-5 py-3 text-[10px] font-mono font-bold uppercase tracking-widest flex items-center gap-2 border-b-4 transition-all ${
                  activeTab === id
                    ? 'border-atomic-orange text-atomic-orange'
                    : 'border-transparent text-deep-teal/50 hover:text-deep-teal'
                }`}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>
 
          {/* Chart area */}
          {activeTab === 'model' && (
            <div className="bg-white retro-border p-6">
              <div className="flex items-center gap-6 mb-4 flex-wrap">
                <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-deep-teal">
                  <span className="w-6 h-0.5 inline-block bg-deep-teal" />
                  Earth TCO ($/PFLOP-day)
                </span>
                <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-atomic-orange">
                  <span
                    className="w-6 h-0.5 inline-block"
                    style={{
                      background: `repeating-linear-gradient(to right, #E85D04 0, #E85D04 6px, transparent 6px, transparent 9px)`,
                    }}
                  />
                  Space TCO ($/PFLOP-day)
                </span>
                <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-mustard">
                  <span className="w-6 h-0.5 inline-block border-t-2 border-dashed border-mustard" />
                  Break-even
                </span>
              </div>
              <CostChart data={modelData} />
              <p className="text-[10px] font-mono text-deep-teal/40 mt-3">
                Shaded region = years where space TCO &lt; Earth TCO. Values in $/PFLOP-day (lower = cheaper compute).
              </p>
            </div>
          )}
 
          {activeTab === 'sensitivity' && (
            <div className="bg-white retro-border p-6">
              <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-deep-teal/60 mb-2 flex items-center gap-2">
                <div className="w-2 h-2 bg-atomic-orange" /> Which Variables Matter Most?
              </h4>
              <p className="text-[11px] text-deep-teal/60 mb-5 leading-relaxed font-mono">
                Each bar shows how much the space/earth cost ratio at year 5 (2030) changes when that variable moves ±20% from your current settings. Longer bar = that assumption is more "load-bearing" to the economic case.
              </p>
              <SensitivityChart data={sensitivityData} />
              <div className="mt-6 bg-deep-teal/5 p-4 border-l-4 border-deep-teal">
                <p className="text-[11px] text-deep-teal font-bold leading-relaxed">
                  Key finding: <span className="text-atomic-orange">{sensitivityData[0]?.label}</span> is the single most load-bearing assumption — a 20% shift changes the 2030 viability ratio by{' '}
                  {(sensitivityData[0]?.swing * 100).toFixed(1)}%. This means the economic case for orbital data centers{' '}
                  {sensitivityData[0]?.key === 'launchCost'
                    ? 'hinges almost entirely on SpaceX Starship delivering on its cost projections.'
                    : sensitivityData[0]?.key === 'launchCostDeclineRate'
                    ? 'depends heavily on how fast launch costs continue to fall.'
                    : 'is most sensitive to this variable — adjust it above to stress-test the model.'}
                </p>
              </div>
            </div>
          )}
 
          {/* Year-by-year table */}
          <div className="bg-white retro-border p-6">
            <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-deep-teal/60 mb-4 flex items-center gap-2">
              <div className="w-2 h-2 bg-deep-teal" /> Year-by-Year Breakdown
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="border-b-2 border-deep-teal">
                    <th className="text-left py-2 text-deep-teal/60 font-bold uppercase tracking-wide">Year</th>
                    <th className="text-right py-2 text-deep-teal font-bold uppercase tracking-wide">Earth $/PFLOP-day</th>
                    <th className="text-right py-2 text-atomic-orange font-bold uppercase tracking-wide">Space $/PFLOP-day</th>
                    <th className="text-right py-2 text-deep-teal/60 font-bold uppercase tracking-wide">Ratio</th>
                    <th className="text-right py-2 text-deep-teal/60 font-bold uppercase tracking-wide">Launch $/kg</th>
                    <th className="text-center py-2 text-deep-teal/60 font-bold uppercase tracking-wide">Viable?</th>
                  </tr>
                </thead>
                <tbody>
                  {modelData.map((row) => (
                    <tr
                      key={row.year}
                      className={`border-b border-deep-teal/10 ${row.viable ? 'bg-deep-teal/5' : ''}`}
                    >
                      <td className="py-2 font-bold text-deep-teal">{row.year}</td>
                      <td className="py-2 text-right text-deep-teal">${row.earthTotal.toFixed(5)}</td>
                      <td className="py-2 text-right text-atomic-orange">${row.spaceTotal.toFixed(5)}</td>
                      <td
                        className="py-2 text-right font-bold"
                        style={{ color: row.viable ? '#0D474E' : '#E85D04' }}
                      >
                        {row.ratio.toFixed(3)}×
                      </td>
                      <td className="py-2 text-right text-deep-teal/60">
                        ${row.launchCostYear.toFixed(0)}
                      </td>
                      <td className="py-2 text-center">
                        {row.viable ? (
                          <span className="bg-deep-teal text-cream px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest">
                            YES
                          </span>
                        ) : (
                          <span className="bg-atomic-orange/10 text-atomic-orange px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest">
                            NOT YET
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
 
          {/* Caveats */}
          <div className="bg-mustard/10 border-2 border-mustard p-6">
            <h4 className="text-[10px] font-mono uppercase tracking-[0.3em] text-mustard font-bold mb-3 flex items-center gap-2">
              <Info className="w-3 h-3" /> Model Limitations
            </h4>
            <ul className="space-y-2 text-[11px] text-deep-teal/70 font-mono leading-relaxed list-none">
              {[
                'Latency-sensitive workloads (real-time transactions, gaming) carry an additional penalty not fully captured — orbital compute is best suited for batch AI training.',
                'Space debris and collision risk costs are not modeled — these represent real long-term externalities discussed by Dr. Carah Ong Whaley in Episode 3.2.',
                'Launch cost projections beyond 5 years are speculative. No Starship at scale yet exists. The model extrapolates historical SpaceX cost curves.',
                'Regulatory cost for space (ITU orbital slot fees, FCC licensing) is held constant — in reality, this may increase as orbital crowding worsens.',
                'This model does not capture winner-take-all dynamics discussed by Prof. Lenox: if AI scaling laws plateau, both sides of this model become less relevant.',
              ].map((c, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="text-mustard font-bold shrink-0">—</span>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
