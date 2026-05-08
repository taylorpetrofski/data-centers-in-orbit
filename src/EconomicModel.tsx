/**
 * Economic Viability Model — Data Centers in Orbit (v3, final)
 * UX: Basic/Advanced mode, tiered sliders, model interpretation panel
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TrendingUp, BarChart2, Sliders, Zap, AlertTriangle, ChevronDown, ChevronUp, Info, BookOpen } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SliderParam {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  citation: string;
  citationUrl: string;
  description: string;
  format: (v: number) => string;
  tier: 1 | 2; // 1 = dominant driver, 2 = secondary
}

type Scenario = 'pessimistic' | 'current' | 'optimistic';

// ─── Fixed sourced constants ──────────────────────────────────────────────────

/**
 * kWh/PFLOP-day (fp16, no sparsity)
 * Derived from NVIDIA DGX H100 spec sheet:
 *   System TDP: 8.5 kW (flopper.io/system/nvidia-dgx-h100; NVIDIA DGX H100 User Guide)
 *   FP16 Tensor Core without sparsity: 3.96 PFLOPS (NVIDIA H100 Datasheet: 1,979 TFLOPS
 *   with sparsity ÷ 2 per GPU × 8 GPUs = 7.92 PFLOPS with / 3.96 without)
 *   kWh/PFLOP-day = 8.5 kW × 24h / 3.96 PFLOPS = 51.5
 */
const EARTH_ENERGY_KWH_PER_PFLOP_DAY = 51.5;

/**
 * Space ops rate: 7%/yr of hardware+launch capex
 * Source: Intelsat/SES combined annual filings 2023–2024:
 *   ~$700–800M OPEX on ~$10B satellite asset base = 7–8%/yr.
 */
const SPACE_OPS_RATE = 0.07;

/**
 * Earth energy inflation: 1.8%/yr
 * Source: EIA Annual Energy Outlook 2025 Reference case:
 *   13¢/kWh (2024) → ~20¢/kWh (2050) = ~1.75%/yr compound.
 *   (theenergy.coop/blog/unpacking-2025-aeo)
 */
const EARTH_ENERGY_BASE_INFLATION = 0.018;

const FIXED_CONSTANTS = [
  { label: 'kWh/PFLOP-day (fp16)', value: '51.5', source: 'NVIDIA DGX H100 spec: 8.5kW ÷ 3.96 PFLOPS × 24h' },
  { label: 'Hardware mass', value: '5 kg/PFLOP', source: 'DGX H100 GPU tray mass ÷ 3.96 PFLOPS; NVIDIA User Guide' },
  { label: 'Earth PUE', value: '1.2×', source: 'Uptime Institute 2024 — new hyperscale builds' },
  { label: 'Ops rate (space)', value: '7%/yr', source: 'Intelsat/SES 2023–24 annual filings' },
  { label: 'Earth energy inflation', value: '1.8%/yr', source: 'EIA AEO 2025 Reference case' },
  { label: 'Solar panel spec power', value: '100 W/kg', source: 'ESA Solar Panel Technology Review 2023' },
  { label: 'Structural overhead', value: '1.4×', source: 'Starcloud white paper 2025' },
];

// ─── Scenario presets ─────────────────────────────────────────────────────────

const SCENARIO_PRESETS: Record<Scenario, Record<string, number>> = {
  pessimistic: {
    launchCost: 2700, earthEnergy: 0.06, computeDoublingYears: 3.5,
    hardwareLifespan: 4, regulationCost: 18, solarEfficiency: 28,
    launchCostDeclineRate: 5, hwCostPerPflop: 500, discountRate: 15,
    computeDemandGrowthRate: 20,
  },
  current: {
    launchCost: 1500, earthEnergy: 0.085, computeDoublingYears: 2.5,
    hardwareLifespan: 6, regulationCost: 12, solarEfficiency: 35,
    launchCostDeclineRate: 12, hwCostPerPflop: 100, discountRate: 10,
    computeDemandGrowthRate: 40,
  },
  optimistic: {
    launchCost: 500, earthEnergy: 0.12, computeDoublingYears: 1.8,
    hardwareLifespan: 7, regulationCost: 6, solarEfficiency: 45,
    launchCostDeclineRate: 20, hwCostPerPflop: 60, discountRate: 8,
    computeDemandGrowthRate: 60,
  },
};

// ─── Core model ───────────────────────────────────────────────────────────────

function computeModel(params: Record<string, number>, years = 10) {
  const {
    launchCost, earthEnergy, computeDoublingYears, hardwareLifespan,
    regulationCost, solarEfficiency, launchCostDeclineRate,
    hwCostPerPflop, discountRate, computeDemandGrowthRate,
  } = params;

  const HW_KG_PER_PFLOP = 5.0;
  const SPACE_LAUNCH_STRUCT_RATIO = 1.4;
  const EARTH_PUE = 1.2;
  const EARTH_LAND_COOLING = 0.0012;
  const SOLAR_PANEL_W_PER_KG = 100;
  const SPACE_LATENCY_PENALTY = 0.04;
  const COMPUTE_KW_PER_PFLOP = EARTH_ENERGY_KWH_PER_PFLOP_DAY / 24;
  const r = discountRate / 100;

  return Array.from({ length: years + 1 }, (_, year) => {
    const discountFactor = Math.pow(1 + r, -year);
    const launchCostYear = launchCost * Math.pow(1 - launchCostDeclineRate / 100, year);
    const demandPressure = Math.max(0, (computeDemandGrowthRate - 20) / 100 * 0.5);
    const earthEnergyYear = earthEnergy * Math.pow(1 + EARTH_ENERGY_BASE_INFLATION + demandPressure, year);
    const computeMultiplier = Math.pow(2, year / computeDoublingYears);

    // Earth TCO
    const earthEnergyCost = EARTH_ENERGY_KWH_PER_PFLOP_DAY * earthEnergyYear * EARTH_PUE;
    const earthRegCost = (earthEnergyCost + EARTH_LAND_COOLING) * (regulationCost / 100);
    const earthTotalUndiscounted = (earthEnergyCost + EARTH_LAND_COOLING + earthRegCost) / computeMultiplier;
    const earthTotal = Math.max(0.00001, earthTotalUndiscounted * discountFactor);

    // Space TCO
    const massPerPflop = (HW_KG_PER_PFLOP * SPACE_LAUNCH_STRUCT_RATIO) / computeMultiplier;
    const solarFraction = Math.max(0.05, solarEfficiency / 100);
    const solarPanelKgPerPflop = COMPUTE_KW_PER_PFLOP / ((SOLAR_PANEL_W_PER_KG / 1000) * solarFraction) / computeMultiplier;
    const totalMassPerPflop = massPerPflop + solarPanelKgPerPflop;
    const lifespanDays = hardwareLifespan * 365;
    const launchAmortized = (totalMassPerPflop * launchCostYear + hwCostPerPflop / computeMultiplier) / lifespanDays;
    const spaceResidualEnergy = earthEnergyCost * 0.02 / computeMultiplier;
    const spaceOpsCost = launchAmortized * SPACE_OPS_RATE;
    const spaceTotalUndiscounted = launchAmortized + spaceResidualEnergy + spaceOpsCost + SPACE_LATENCY_PENALTY * earthTotalUndiscounted;
    const spaceTotal = Math.max(0.00001, spaceTotalUndiscounted * discountFactor);

    return {
      year: 2025 + year, earthTotal, spaceTotal,
      ratio: spaceTotal / earthTotal,
      launchCostYear, earthEnergyYear, discountFactor,
      viable: spaceTotal / earthTotal < 1,
    };
  });
}

function computeSensitivity(params: Record<string, number>) {
  const base5 = computeModel(params, 10)[5].ratio;
  const DELTA = 0.20;
  return Object.keys(params).map((key) => {
    const hi = computeModel({ ...params, [key]: params[key] * (1 + DELTA) }, 10)[5].ratio;
    const lo = computeModel({ ...params, [key]: params[key] * (1 - DELTA) }, 10)[5].ratio;
    return { key, swing: Math.abs(hi - lo), hurtsSpace: hi > base5 };
  }).sort((a, b) => b.swing - a.swing);
}

function computeConfidenceBands(params: Record<string, number>, years = 10, n = 300, unc = 0.25) {
  const runs = Array.from({ length: n }, () => {
    const p: Record<string, number> = {};
    for (const k of Object.keys(params)) {
      p[k] = Math.max(params[k] * 0.1, params[k] * (1 + (Math.random() * 2 - 1) * unc));
    }
    return computeModel(p, years);
  });
  return Array.from({ length: years + 1 }, (_, y) => {
    const ratios = runs.map(r => r[y].ratio).sort((a, b) => a - b);
    return { year: 2025 + y, p10: ratios[Math.floor(n * 0.1)], p50: ratios[Math.floor(n * 0.5)], p90: ratios[Math.floor(n * 0.9)] };
  });
}

// ─── Model interpretation engine ──────────────────────────────────────────────

function buildInterpretation(params: Record<string, number>, modelData: ReturnType<typeof computeModel>, sensitivityData: ReturnType<typeof computeSensitivity>) {
  const breakEvenYear = modelData.find(d => d.viable)?.year;
  const ratio0 = modelData[0].ratio;
  const ratio5 = modelData[5].ratio;
  const ratio10 = modelData[10].ratio;

  const trajectory = ratio10 < ratio0 * 0.7 ? 'rapidly improving' : ratio10 < ratio0 * 0.9 ? 'gradually improving' : ratio10 < ratio0 ? 'slowly improving' : 'stagnant or worsening';

  const currentVerdict = breakEvenYear
    ? `Orbital compute becomes cost-competitive around ${breakEvenYear} under current assumptions.`
    : ratio5 < 1.3
    ? 'Orbital compute approaches parity by 2030 but does not clearly cross over within the 10-year window.'
    : 'Orbital compute remains significantly more expensive through 2035 under current assumptions.';

  // Top 3 drivers from sensitivity
  const top3 = sensitivityData.slice(0, 3);
  const driverLabels: Record<string, string> = {
    launchCost: 'launch economics',
    launchCostDeclineRate: 'Starship cost decline trajectory',
    hwCostPerPflop: 'space-grade hardware cost',
    discountRate: 'capital structure and discount rate',
    computeDemandGrowthRate: 'AI compute demand growth',
    earthEnergy: 'terrestrial energy prices',
    computeDoublingYears: 'compute efficiency improvement rate',
    hardwareLifespan: 'orbital hardware lifespan',
    solarEfficiency: 'solar power harvest efficiency',
    regulationCost: 'regulatory overhead',
  };

  const mainDrivers = top3.filter(d => d.hurtsSpace).map(d => driverLabels[d.key] || d.key);
  const mainHelpers = top3.filter(d => !d.hurtsSpace).map(d => driverLabels[d.key] || d.key);

  const risks = [];
  if (params.hwCostPerPflop > 200) risks.push('Space-grade ASIC development risk — no orbital ASICs exist at scale yet');
  if (params.launchCostDeclineRate < 10) risks.push('Starship ramp delay — slow launch cost decline extends the payback horizon significantly');
  if (params.discountRate > 12) risks.push('Capital intensity — high discount rates heavily penalize the upfront launch capex');
  if (params.hardwareLifespan < 5) risks.push('Radiation-related hardware degradation — short lifespan compresses amortization window');
  if (risks.length === 0) risks.push('Optimistic scenario — all major risks assume favorable resolution');

  const confidence =
    ratio0 > 2.0 ? 'Low — space is far from viable; requires major technological breakthroughs'
    : ratio5 < 1.1 ? 'Moderate-High — economics are close to parity within this decade'
    : ratio5 < 1.5 ? 'Moderate — scenario is plausible given continued Starship progress'
    : 'Low-Moderate — requires optimistic assumptions on multiple dimensions simultaneously';

  const bottomLine = breakEvenYear
    ? `Under current assumptions, orbital compute crosses the cost threshold around ${breakEvenYear} — contingent on launch costs declining at ${params.launchCostDeclineRate}%/yr and space-grade ASICs reaching ~$${params.hwCostPerPflop}/PFLOP.`
    : ratio5 < 1.3
    ? `Orbital compute approaches parity with terrestrial hyperscalers by 2030, but does not clearly cross over within the decade without further improvement in launch economics or hardware cost.`
    : `Under current assumptions, orbital compute is unlikely to beat terrestrial hyperscalers before the mid-2030s unless launch costs continue declining at double-digit annual rates.`;

  return { currentVerdict, trajectory, mainDrivers, mainHelpers, risks, confidence, breakEvenYear, bottomLine };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const InfoTooltip = ({ text, url }: { text: string; url: string }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      // Prefer opening to the right; if too close to right edge, open left
      const spaceRight = window.innerWidth - r.right;
      const tooltipW = 288; // w-72
      const left = spaceRight > tooltipW + 8 ? r.right + 4 : r.left - tooltipW - 4;
      // Prefer opening downward; flip up if near bottom
      const spaceBelow = window.innerHeight - r.bottom;
      const top = spaceBelow > 160 ? r.top : r.bottom - 160;
      setPos({ top, left });
    }
    setOpen(o => !o);
  };

  return (
    <div ref={ref} className="relative inline-block ml-1.5 align-middle">
      <button ref={btnRef} type="button" onClick={handleOpen}
        className="w-4 h-4 rounded-full border border-deep-teal/30 flex items-center justify-center text-[8px] font-mono font-bold text-deep-teal/40 hover:border-atomic-orange hover:text-atomic-orange transition-colors flex-shrink-0">
        i
      </button>
      {open && (
        <div
          className="fixed z-[9999] w-72 bg-white border-2 border-deep-teal shadow-[4px_4px_0px_0px_rgba(13,71,78,1)] p-3 text-[11px] text-deep-teal leading-relaxed"
          style={{ top: pos.top, left: pos.left }}
        >
          <p className="mb-2">{text}</p>
          <a href={url} target="_blank" rel="noreferrer" className="text-atomic-orange underline font-bold break-all">View source →</a>
        </div>
      )}
    </div>
  );
};

const SliderRow = ({ param, onChange, compact }: { param: SliderParam; onChange: (id: string, v: number) => void; compact?: boolean }) => (
  <div className={`${compact ? 'py-3' : 'py-4'} border-b border-deep-teal/10 last:border-0`}>
    <div className="flex items-center justify-between mb-1">
      <span className="text-[10px] font-bold text-deep-teal uppercase tracking-tight flex items-center">
        {param.label}
        <InfoTooltip text={param.citation} url={param.citationUrl} />
      </span>
      <span className="text-[10px] font-mono font-bold text-atomic-orange bg-atomic-orange/10 px-2 py-0.5 ml-2 flex-shrink-0">
        {param.format(param.value)}
      </span>
    </div>
    {!compact && <p className="text-[10px] text-deep-teal/45 mb-2 font-mono leading-relaxed">{param.description}</p>}
    <input type="range" min={param.min} max={param.max} step={param.step} value={param.value}
      onChange={e => onChange(param.id, parseFloat(e.target.value))}
      className="w-full h-1.5 appearance-none bg-deep-teal/15 rounded-none cursor-pointer"
      style={{ accentColor: '#E85D04' }} />
    <div className="flex justify-between text-[9px] font-mono text-deep-teal/25 mt-0.5">
      <span>{param.format(param.min)}</span>
      <span>{param.format(param.max)}</span>
    </div>
  </div>
);

const CostChart = ({ data, bands }: { data: ReturnType<typeof computeModel>; bands: ReturnType<typeof computeConfidenceBands> }) => {
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
    const W = rect.width, H = rect.height;
    const PAD = { top: 20, right: 20, bottom: 36, left: 78 };
    const cW = W - PAD.left - PAD.right, cH = H - PAD.top - PAD.bottom;
    ctx.clearRect(0, 0, W, H);

    const maxVal = Math.max(...data.flatMap(d => [d.earthTotal, d.spaceTotal]),
      ...bands.map((b, i) => b.p90 * data[i].earthTotal)) * 1.15;
    const xS = (i: number) => PAD.left + (i / (data.length - 1)) * cW;
    const yS = (v: number) => PAD.top + cH - (Math.max(0, v) / maxVal) * cH;

    // Grid
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (cH / 4) * i;
      ctx.strokeStyle = 'rgba(13,71,78,0.07)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
      ctx.fillStyle = 'rgba(13,71,78,0.35)'; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'right';
      ctx.fillText(`$${(maxVal * (1 - i / 4)).toFixed(1)}`, PAD.left - 5, y + 3);
    }
    ctx.fillStyle = 'rgba(13,71,78,0.35)'; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'center';
    data.forEach((d, i) => { if (i % 2 === 0) ctx.fillText(String(d.year), xS(i), H - PAD.bottom + 16); });

    // Viability shading
    let inZ = false, startX = 0;
    data.forEach((d, i) => {
      if (d.viable && !inZ) { startX = xS(i); inZ = true; }
      else if (!d.viable && inZ) { ctx.fillStyle = 'rgba(13,71,78,0.05)'; ctx.fillRect(startX, PAD.top, xS(i) - startX, cH); inZ = false; }
    });
    if (inZ) { ctx.fillStyle = 'rgba(13,71,78,0.05)'; ctx.fillRect(startX, PAD.top, xS(data.length - 1) - startX, cH); }

    // Confidence band
    ctx.beginPath();
    bands.forEach((b, i) => { const y = yS(b.p90 * data[i].earthTotal); i === 0 ? ctx.moveTo(xS(i), y) : ctx.lineTo(xS(i), y); });
    bands.slice().reverse().forEach((b, i) => { const ri = bands.length - 1 - i; ctx.lineTo(xS(ri), yS(b.p10 * data[ri].earthTotal)); });
    ctx.closePath(); ctx.fillStyle = 'rgba(232,93,4,0.08)'; ctx.fill();

    // Earth line
    ctx.beginPath(); ctx.strokeStyle = '#0D474E'; ctx.lineWidth = 2.5; ctx.setLineDash([]);
    data.forEach((d, i) => { i === 0 ? ctx.moveTo(xS(i), yS(d.earthTotal)) : ctx.lineTo(xS(i), yS(d.earthTotal)); });
    ctx.stroke();

    // Space line
    ctx.beginPath(); ctx.strokeStyle = '#E85D04'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 3]);
    data.forEach((d, i) => { i === 0 ? ctx.moveTo(xS(i), yS(d.spaceTotal)) : ctx.lineTo(xS(i), yS(d.spaceTotal)); });
    ctx.stroke(); ctx.setLineDash([]);

    // Crossover
    const crossIdx = data.findIndex(d => d.viable);
    if (crossIdx > 0) {
      const x = xS(crossIdx);
      ctx.strokeStyle = '#E4A725'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + cH); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#E4A725';
      ctx.font = 'bold 8px JetBrains Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText('VIABLE', x, PAD.top + 11);
    }
  }, [data, bands]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '240px', display: 'block' }} aria-label="Cost trajectory chart" />;
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EconomicModel() {
  const [activeScenario, setActiveScenario] = useState<Scenario>('current');
  const [params, setParams] = useState(SCENARIO_PRESETS.current);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chart' | 'sensitivity' | 'table'>('chart');
  const [showFixedConstants, setShowFixedConstants] = useState(false);

  const allSliderDefs: SliderParam[] = [
    // TIER 1 — Dominant Drivers
    {
      id: 'launchCostDeclineRate', tier: 1,
      label: 'Launch cost decline rate',
      min: 0, max: 35, step: 1,
      format: v => `${v}%/yr`,
      citation: 'Google Suncatcher (Nov 2025) projects $1,500→$200/kg by 2035, implying ~22%/yr if Starship reaches 180 launches/yr. Derivation: (200/1500)^(1/10)–1 = –15.3%/yr at full Starship utilization. Current preset (12%/yr) splits between historical Falcon 9 plateau (~5%/yr) and Google\'s optimistic Starship trajectory. Starcloud CEO: "$500/kg = cost-competitive" (TechCrunch, Apr 2026).',
      citationUrl: 'https://www.semafor.com/article/11/04/2025/google-wants-to-build-solar-powered-data-centers-in-space',
      description: 'How fast launch costs fall year-over-year as Starship scales — the single biggest lever in this model',
      value: params.launchCostDeclineRate,
    },
    {
      id: 'computeDemandGrowthRate', tier: 1,
      label: 'AI compute demand growth',
      min: 10, max: 100, step: 5,
      format: v => `${v}%/yr`,
      citation: 'IEA "Energy and AI" (June 2024): AI electricity demand projected +26–40%/yr through 2030. Goldman Sachs 2025: data center power demand +165% by 2030 (~60%/yr). FERC 2025 capacity markets: PJM capacity prices up 800% in 2024→2025 auction due to data center load growth. Higher demand growth stresses grid, accelerating terrestrial energy price inflation above EIA\'s 1.8%/yr baseline.',
      citationUrl: 'https://www.iea.org/reports/energy-and-ai',
      description: 'Annual growth in AI compute demand — drives grid stress and terrestrial energy price pressure',
      value: params.computeDemandGrowthRate,
    },
    {
      id: 'earthEnergy', tier: 1,
      label: 'Earth energy price',
      min: 0.02, max: 0.25, step: 0.005,
      format: v => `$${v.toFixed(3)}/kWh`,
      citation: 'EIA 2025 STEO: US commercial average $0.085/kWh. Base inflation corrected to 1.8%/yr (EIA AEO 2025 Reference case: 13¢→20¢/kWh by 2050). Energy cost dominates Earth TCO — at $0.085/kWh: 51.5 kWh/PFLOP × $0.085 × PUE 1.2 = $5.25/PFLOP-day in energy alone.',
      citationUrl: 'https://www.eia.gov/outlooks/aeo/',
      description: 'Grid electricity cost for terrestrial data centers — grows at 1.8%/yr base + demand stress',
      value: params.earthEnergy,
    },
    {
      id: 'computeDoublingYears', tier: 1,
      label: 'Compute efficiency doubling time',
      min: 1, max: 5, step: 0.1,
      format: v => `${v.toFixed(1)} yrs`,
      citation: 'Epoch AI (Oct 2024): ML hardware energy efficiency doubled ~every 2yr since 2012. Epoch AI (Apr 2025): AI supercomputers doubled performance every 9 months 2019–2025. IEA via Congress.gov 2025: GPU performance/watt improved 100× between 2008–2023. Fast doubling slightly favors Earth — space hardware locks in year-0 efficiency for its full lifespan.',
      citationUrl: 'https://epoch.ai/data-insights/ml-hardware-energy-efficiency',
      description: 'Years for compute performance per dollar/watt to double — orbital hardware is locked in at launch-year efficiency',
      value: params.computeDoublingYears,
    },
    {
      id: 'discountRate', tier: 1,
      label: 'Discount rate (NPV)',
      min: 4, max: 25, step: 0.5,
      format: v => `${v}%`,
      citation: 'Required annual return for NPV discounting. Infrastructure project finance: 7–9% (green bonds 2025). Venture capital floor: 20–30%. JPMorgan infrastructure fund WACC: 8–12% (2025). Higher discount rates penalize space more — the entire launch capex is front-loaded, while Earth\'s energy opex is spread evenly over time.',
      citationUrl: 'https://www.congress.gov/crs-product/R48646',
      description: 'Required annual return for discounting — asymmetrically penalizes space\'s upfront launch capex',
      value: params.discountRate,
    },
    // TIER 2 — Secondary Variables
    {
      id: 'launchCost', tier: 2,
      label: 'Current launch cost',
      min: 100, max: 5000, step: 50,
      format: v => `$${v.toLocaleString()}/kg`,
      citation: 'Google Suncatcher (Nov 2025): ~$1,500–2,900/kg on Falcon Heavy today. NASA NTRS: Falcon 9 list price $2,720/kg. Starcloud CEO: $500/kg = cost-competitive (TechCrunch, Apr 2026). Google: $200/kg needed by 2035 for viability, requiring Starship at 180 launches/yr.',
      citationUrl: 'https://www.datacenterdynamics.com/en/news/project-suncatcher-google-to-launch-tpus-into-orbit-with-planet-labs-envisions-1km-arrays-of-81-satellite-compute-clusters/',
      description: 'Today\'s cost to lift 1 kg to LEO — the decline rate is more important than the starting value',
      value: params.launchCost,
    },
    {
      id: 'hwCostPerPflop', tier: 2,
      label: 'Space hardware cost',
      min: 30, max: 1500, step: 10,
      format: v => `$${v}/PFLOP`,
      citation: 'CRITICAL CAVEAT. Retail H100: ~$7,000/PFLOP fp16 no-sparsity (DGX H100 ~$300k ÷ 3.96 PFLOPS). Space-optimized ASICs at volume (Google Trillium TPU class): estimated $60–200/PFLOP. No orbital ASICs exist yet — only retail H100s have been flown (Starcloud-1, Nov 2025). The entire economic case rests on ASIC development.',
      citationUrl: 'https://starcloudinc.github.io/wp.pdf',
      description: 'Cost of space-grade compute hardware — retail GPUs make space permanently unviable; ASICs are required',
      value: params.hwCostPerPflop,
    },
    {
      id: 'hardwareLifespan', tier: 2,
      label: 'Orbital hardware lifespan',
      min: 2, max: 12, step: 0.5,
      format: v => `${v.toFixed(1)} yrs`,
      citation: 'Google Suncatcher (Nov 2025): "replace onboard chips every 5–6 years." LEO satellites typically 5–15yr depending on radiation shielding (Avnet Silica / IEEE Trans. Aerospace). Low-cost nanosatellites: 2–4yr due to radiation and drag. Starcloud-1 launched Nov 2025 — no multi-year operational compute lifespan data exists yet.',
      citationUrl: 'https://www.scientificamerican.com/article/data-centers-in-space/',
      description: 'Years orbital hardware operates before replacement — radiation degrades silicon faster in LEO',
      value: params.hardwareLifespan,
    },
    {
      id: 'solarEfficiency', tier: 2,
      label: 'Solar harvest efficiency',
      min: 10, max: 65, step: 1,
      format: v => `${v}%`,
      citation: 'Modeled by panel mass: power demand ÷ (100 W/kg × efficiency). ESA Solar Panel Tech Review 2023: triple-junction GaAs at 90–120 W/kg. Google Suncatcher: orbital capacity factor 95% vs 24% ground = 8× more energy. Reduced by LEO night windows (~35% dark time), thermal losses, battery cycling, panel degradation (~1.5%/yr).',
      citationUrl: 'https://interestingengineering.com/culture/google-project-suncatcher-space-ai',
      description: 'Fraction of theoretical solar irradiance usable — drives required panel mass per PFLOP of compute',
      value: params.solarEfficiency,
    },
    {
      id: 'regulationCost', tier: 2,
      label: 'Earth regulatory overhead',
      min: 0, max: 30, step: 1,
      format: v => `${v}% of OPEX`,
      citation: 'UMich STPP 2025: compliance, permitting, and regulatory costs 8–20% of OPEX for US data centers. Note: Prof. Philip Potter (UVA) argues hyperscalers negotiate tax abatements and rarely cite regulation as primary driver. Sensitivity analysis confirms this is one of the lowest-impact variables in the model.',
      citationUrl: 'https://stpp.fordschool.umich.edu/sites/stpp/files/2025-07/stpp-data-centers-2025.pdf',
      description: 'Regulatory compliance overhead — sensitivity analysis shows this has relatively small impact',
      value: params.regulationCost,
    },
  ];

  const tier1Sliders = allSliderDefs.filter(s => s.tier === 1);
  const tier2Sliders = allSliderDefs.filter(s => s.tier === 2);

  const handleSliderChange = (id: string, val: number) => {
    setParams(p => ({ ...p, [id]: val }));
    setActiveScenario('current');
  };
  const applyScenario = (s: Scenario) => { setActiveScenario(s); setParams(SCENARIO_PRESETS[s]); };

  const modelData = useMemo(() => computeModel(params, 10), [params]);
  const sensitivityData = useMemo(() => computeSensitivity(params), [params]);
  const confidenceBands = useMemo(() => computeConfidenceBands(params, 10, 300, 0.25), [params]);
  const interpretation = useMemo(() => buildInterpretation(params, modelData, sensitivityData), [params, modelData, sensitivityData]);

  const ratio0 = modelData[0].ratio;
  const ratio5 = modelData[5].ratio;
  const breakEvenYear = modelData.find(d => d.viable)?.year;

  const verdictColor = ratio0 < 0.9 ? '#0D474E' : ratio0 < 1.2 ? '#E4A725' : '#E85D04';

  return (
    <div className="min-h-screen bg-cream pt-28 pb-24 px-6 md:px-10 max-w-[1400px] mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="mb-12">
        <div className="text-[9px] font-mono text-deep-teal/40 uppercase tracking-[0.5em] mb-4">
          TOPIC_ID: ORBITAL_COMPUTE_ECONOMICS // v3
        </div>
        <div className="flex flex-col md:flex-row items-start gap-8 mb-8">
          <div>
            <h1 className="text-5xl md:text-7xl font-display font-black text-deep-teal uppercase italic tracking-tighter leading-none mb-3">
              Orbital<br /><span className="text-atomic-orange">Economics</span>
            </h1>
            <p className="text-sm font-mono text-deep-teal/60 max-w-xl leading-relaxed">
              Under what conditions do data centers in orbit make economic sense?
              Every assumption is sourced. Adjust them — watch the math respond.
            </p>
          </div>
        </div>

        {/* Scenario buttons */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[9px] font-mono uppercase tracking-[0.3em] text-deep-teal/40 mr-2">Preset:</span>
          {(['pessimistic', 'current', 'optimistic'] as Scenario[]).map(s => (
            <button key={s} onClick={() => applyScenario(s)}
              className={`px-4 py-1.5 text-[10px] font-mono font-bold uppercase tracking-widest border-2 transition-all ${
                activeScenario === s
                  ? 'bg-deep-teal text-cream border-deep-teal'
                  : 'bg-transparent text-deep-teal border-deep-teal/30 hover:border-deep-teal'
              }`}>
              {s === 'pessimistic' ? 'Conservative Case' : s === 'current' ? 'Base Case' : 'Frontier Adoption'}
            </button>
          ))}
        </div>
      </motion.div>

      {/* ── Main 3-column layout ───────────────────────────────────────────── */}
      <div className="grid xl:grid-cols-[360px_1fr_320px] lg:grid-cols-[340px_1fr] gap-8 items-start">

        {/* ── LEFT: Sliders ─────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Tier 1 */}
          <div className="bg-white border-2 border-deep-teal shadow-[4px_4px_0px_0px_rgba(13,71,78,0.15)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-5 bg-atomic-orange" />
              <div>
                <div className="text-[9px] font-mono uppercase tracking-[0.3em] text-deep-teal/50">Tier 1</div>
                <div className="text-xs font-black text-deep-teal uppercase tracking-tight">Dominant Drivers</div>
              </div>
            </div>
            <div>
              {tier1Sliders.map(p => (
                <SliderRow key={p.id} param={{ ...p, value: params[p.id] }} onChange={handleSliderChange} />
              ))}
            </div>
          </div>

          {/* Tier 2 — collapsible */}
          <div className="border-2 border-deep-teal/25 bg-white/70">
            <button
              onClick={() => setAdvancedOpen(o => !o)}
              className="w-full flex items-center justify-between p-4 hover:bg-deep-teal/3 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-2 h-5 bg-deep-teal/30" />
                <div className="text-left">
                  <div className="text-[9px] font-mono uppercase tracking-[0.3em] text-deep-teal/40">Tier 2</div>
                  <div className="text-xs font-black text-deep-teal/70 uppercase tracking-tight">Secondary Variables</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-deep-teal/40">
                {advancedOpen ? 'collapse' : 'expand'}
                {advancedOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>
            <AnimatePresence>
              {advancedOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 border-t border-deep-teal/15">
                    {tier2Sliders.map(p => (
                      <SliderRow key={p.id} param={{ ...p, value: params[p.id] }} onChange={handleSliderChange} compact />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Fixed constants — collapsible */}
          <div className="border-2 border-deep-teal/15 bg-deep-teal/3">
            <button onClick={() => setShowFixedConstants(o => !o)}
              className="w-full flex items-center justify-between p-3 hover:bg-deep-teal/5 transition-colors">
              <span className="text-[9px] font-mono uppercase tracking-[0.3em] text-deep-teal/50 flex items-center gap-2">
                <BookOpen className="w-3 h-3" /> Fixed sourced constants
              </span>
              {showFixedConstants ? <ChevronUp className="w-3 h-3 text-deep-teal/40" /> : <ChevronDown className="w-3 h-3 text-deep-teal/40" />}
            </button>
            <AnimatePresence>
              {showFixedConstants && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                  <div className="px-4 pb-4 space-y-0 border-t border-deep-teal/10">
                    {FIXED_CONSTANTS.map(c => (
                      <div key={c.label} className="flex justify-between items-start py-2 border-b border-deep-teal/8 last:border-0">
                        <div>
                          <div className="text-[10px] font-mono font-bold text-deep-teal">{c.label}</div>
                          <div className="text-[9px] font-mono text-deep-teal/35 leading-tight">{c.source}</div>
                        </div>
                        <div className="text-[10px] font-mono font-bold text-atomic-orange ml-3 shrink-0">{c.value}</div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── CENTER: Chart + tabs ───────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Summary row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                label: 'Current ratio',
                value: ratio0.toFixed(2) + '×',
                sub: ratio0 < 1 ? 'Space cheaper now' : 'Earth cheaper now',
                color: ratio0 < 1 ? '#0D474E' : '#E85D04',
              },
              {
                label: 'Ratio at 2030',
                value: ratio5.toFixed(2) + '×',
                sub: ratio5 < 1 ? 'Space wins by 2030' : 'Earth still cheaper',
                color: ratio5 < 1 ? '#0D474E' : '#E85D04',
              },
              {
                label: 'Break-even',
                value: breakEvenYear ? String(breakEvenYear) : '2035+',
                sub: breakEvenYear ? 'Space becomes viable' : 'Beyond 10yr window',
                color: breakEvenYear ? '#0D474E' : '#E85D04',
              },
            ].map(card => (
              <div key={card.label} className="bg-white border-2 border-deep-teal/20 p-4">
                <div className="text-[9px] font-mono uppercase tracking-widest text-deep-teal/45 mb-1">{card.label}</div>
                <div className="text-2xl font-display font-black" style={{ color: card.color }}>{card.value}</div>
                <div className="text-[10px] font-mono text-deep-teal/50 mt-0.5">{card.sub}</div>
              </div>
            ))}
          </div>

          {/* Verdict bar */}
          <div className="flex items-center gap-3 p-3.5 border-2" style={{ borderColor: verdictColor + '40', background: verdictColor + '08' }}>
            <Zap className="w-4 h-4 shrink-0" style={{ color: verdictColor }} />
            <span className="text-[11px] font-mono text-deep-teal/70 leading-relaxed">
              Space costs <strong style={{ color: verdictColor }}>{Math.abs((ratio0 * 100 - 100)).toFixed(0)}%</strong>{' '}
              {ratio0 >= 1 ? 'more' : 'less'} per NPV-adjusted PFLOP-day today.
              {breakEvenYear
                ? ` Cost-competitive by ${breakEvenYear} under current assumptions.`
                : ratio5 < 1.3
                ? ' Approaches parity by 2030.'
                : ' Requires significant parameter shifts to become viable within the decade.'}
            </span>
          </div>

          {/* Tabs */}
          <div>
            <div className="flex border-b-2 border-deep-teal/15">
              {[
                { id: 'chart' as const, label: '10-Year Trajectory', icon: BarChart2 },
                { id: 'sensitivity' as const, label: 'Sensitivity', icon: Sliders },
                { id: 'table' as const, label: 'NPV Table', icon: TrendingUp },
              ].map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setActiveTab(id)}
                  className={`px-4 py-2.5 text-[10px] font-mono font-bold uppercase tracking-widest flex items-center gap-1.5 border-b-4 transition-all ${
                    activeTab === id
                      ? 'border-atomic-orange text-atomic-orange'
                      : 'border-transparent text-deep-teal/40 hover:text-deep-teal'
                  }`}>
                  <Icon className="w-3 h-3" />{label}
                </button>
              ))}
            </div>

            <div className="bg-white border-2 border-deep-teal/15 border-t-0 p-5">
              {activeTab === 'chart' && (
                <>
                  <div className="flex flex-wrap gap-5 mb-4">
                    {[
                      { color: '#0D474E', dash: false, label: 'Earth TCO (NPV-adjusted)' },
                      { color: '#E85D04', dash: true, label: 'Space TCO (NPV-adjusted)' },
                      { color: '#E85D04', dash: false, bg: true, label: '±25% uncertainty band' },
                    ].map(item => (
                      <span key={item.label} className="flex items-center gap-2 text-[10px] font-mono text-deep-teal/60">
                        {item.bg
                          ? <span className="w-6 h-3 inline-block bg-atomic-orange/10 border border-atomic-orange/30" />
                          : <span className="w-6 h-0.5 inline-block" style={{
                              background: item.dash
                                ? `repeating-linear-gradient(to right, ${item.color} 0, ${item.color} 5px, transparent 5px, transparent 8px)`
                                : item.color
                            }} />
                        }
                        {item.label}
                      </span>
                    ))}
                  </div>
                  <CostChart data={modelData} bands={confidenceBands} />
                  <p className="text-[9px] font-mono text-deep-teal/35 mt-3">
                    Green shading = space TCO &lt; Earth TCO. Orange band = p10–p90 of 300 Monte Carlo runs (±25% parameter uncertainty). Units: $/PFLOP-day, fp16 no-sparsity.
                  </p>
                </>
              )}

              {activeTab === 'sensitivity' && (
                <>
                  <p className="text-[11px] font-mono text-deep-teal/55 mb-4 leading-relaxed">
                    Each bar shows how much the space/earth ratio at 2030 changes when a variable shifts ±20%. Longer bar = bigger impact.
                  </p>
                  <div className="space-y-3">
                    {sensitivityData.map(item => {
                      const PARAM_LABELS: Record<string, string> = {
                        launchCostDeclineRate: 'Launch cost decline rate',
                        computeDemandGrowthRate: 'AI compute demand growth',
                        earthEnergy: 'Earth energy price',
                        computeDoublingYears: 'Compute efficiency doubling',
                        discountRate: 'Discount rate',
                        launchCost: 'Starting launch cost',
                        hwCostPerPflop: 'Space hardware cost',
                        hardwareLifespan: 'Hardware lifespan',
                        solarEfficiency: 'Solar harvest efficiency',
                        regulationCost: 'Regulatory overhead',
                      };
                      const maxSwing = Math.max(...sensitivityData.map(d => d.swing));
                      const tier = tier1Sliders.find(s => s.id === item.key) ? 1 : 2;
                      return (
                        <div key={item.key}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-mono font-bold text-deep-teal uppercase tracking-tight flex items-center gap-1.5">
                              {tier === 1 && <span className="w-1.5 h-1.5 bg-atomic-orange inline-block" />}
                              {PARAM_LABELS[item.key] || item.key}
                            </span>
                            <span className="text-[9px] font-mono px-1.5 py-0.5 font-bold" style={{
                              background: item.hurtsSpace ? 'rgba(232,93,4,0.08)' : 'rgba(13,71,78,0.06)',
                              color: item.hurtsSpace ? '#E85D04' : '#0D474E',
                            }}>
                              {item.hurtsSpace ? '↑ hurts space' : '↑ helps space'}
                            </span>
                          </div>
                          <div className="h-2.5 bg-deep-teal/8 w-full">
                            <div className="h-full transition-all duration-500" style={{
                              width: `${(item.swing / maxSwing) * 100}%`,
                              background: item.hurtsSpace ? '#E85D04' : '#0D474E',
                              opacity: tier === 1 ? 1 : 0.45,
                            }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex gap-4 text-[9px] font-mono text-deep-teal/40">
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 inline-block bg-atomic-orange" /> Tier 1 dominant driver</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 inline-block bg-atomic-orange opacity-45" /> Tier 2 secondary</span>
                  </div>
                </>
              )}

              {activeTab === 'table' && (
                <>
                  <p className="text-[10px] font-mono text-deep-teal/50 mb-3">
                    Earth energy at year 0: ${(EARTH_ENERGY_KWH_PER_PFLOP_DAY * params.earthEnergy * 1.2).toFixed(2)}/PFLOP-day
                    (= {EARTH_ENERGY_KWH_PER_PFLOP_DAY} kWh/PFLOP × ${params.earthEnergy.toFixed(3)}/kWh × PUE 1.2).
                    Discount rate: {params.discountRate}%/yr.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px] font-mono">
                      <thead>
                        <tr className="border-b-2 border-deep-teal">
                          {['Year', 'Earth $/PFLOP-d', 'Space $/PFLOP-d', 'Discount', 'Ratio', '$/kg', 'Viable?'].map(h => (
                            <th key={h} className={`py-2 font-bold uppercase tracking-wide text-deep-teal/60 ${h === 'Year' || h === 'Viable?' ? 'text-left' : 'text-right'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {modelData.map(row => (
                          <tr key={row.year} className={`border-b border-deep-teal/8 ${row.viable ? 'bg-deep-teal/4' : ''}`}>
                            <td className="py-1.5 font-bold text-deep-teal">{row.year}</td>
                            <td className="py-1.5 text-right text-deep-teal">${row.earthTotal.toFixed(2)}</td>
                            <td className="py-1.5 text-right text-atomic-orange">${row.spaceTotal.toFixed(2)}</td>
                            <td className="py-1.5 text-right text-deep-teal/45">{row.discountFactor.toFixed(3)}×</td>
                            <td className="py-1.5 text-right font-bold" style={{ color: row.viable ? '#0D474E' : '#E85D04' }}>
                              {row.ratio.toFixed(3)}×
                            </td>
                            <td className="py-1.5 text-right text-deep-teal/45">${row.launchCostYear.toFixed(0)}</td>
                            <td className="py-1.5">
                              {row.viable
                                ? <span className="bg-deep-teal text-cream px-1.5 py-0.5 text-[8px] font-bold uppercase">YES</span>
                                : <span className="bg-atomic-orange/10 text-atomic-orange px-1.5 py-0.5 text-[8px] font-bold uppercase">NOT YET</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Limitations */}
          <details className="border-2 border-mustard/50 bg-mustard/5">
            <summary className="p-4 cursor-pointer text-[10px] font-mono uppercase tracking-[0.25em] text-mustard font-bold flex items-center gap-2 list-none">
              <AlertTriangle className="w-3 h-3" /> Model Limitations & Caveats
            </summary>
            <div className="px-5 pb-5">
              <ul className="space-y-2.5 text-[11px] text-deep-teal/65 font-mono leading-relaxed">
                {[
                  'Hardware cost ($/PFLOP) is the most critical unverified assumption. No space-grade ASICs exist at volume. The only orbital GPU flown is a retail H100 (Starcloud-1, Nov 2025) at ~$7,000/PFLOP — permanently unviable at any launch cost. The $100/PFLOP preset is where Google\'s Trillium program aims; it does not yet exist.',
                  'kWh/PFLOP-day uses DGX H100 theoretical peak fp16 performance. Real training throughput is typically 30–60% of peak due to memory bandwidth bottlenecks and inter-GPU communication. True effective kWh/PFLOP-day could be 2–3× higher — this affects both sides proportionally, not the ratio, but absolute cost levels are conservative.',
                  'NPV discount rate is applied uniformly. Rigorous modeling would use separate rates for capex (upfront launch) vs. ongoing opex (energy) — a full project finance model would produce different optimal launch timing.',
                  'Space debris, orbital slot fees, collision insurance, and end-of-life deorbit cost are not modeled. Dr. Carah Ong Whaley (Episode 3.2) argues these are real unpriced externalities that grow nonlinearly with constellation size.',
                  'Launch cost decline is modeled as a smooth compound rate. In reality it is lumpy — dependent on discrete Starship milestones. A single failure could reset the timeline 2–3 years. The ±25% Monte Carlo bands partially capture this.',
                  'If AI scaling laws plateau (Prof. Lenox, Episode 2), both sides of this model become less relevant. The entire premise assumes sustained compute demand growth.',
                ].map((c, i) => (
                  <li key={i} className="flex gap-2 items-start"><span className="text-mustard shrink-0 font-bold">—</span>{c}</li>
                ))}
              </ul>
            </div>
          </details>
        </div>

        {/* ── RIGHT: Model Interpretation ──────────────────────────────────── */}
        <div className="space-y-3 xl:block hidden">

          {/* Main panel */}
          <div className="bg-deep-teal text-cream shadow-[4px_4px_0px_0px_rgba(13,71,78,0.25)] divide-y divide-cream/10">

            {/* Header */}
            <div className="px-5 pt-5 pb-4">
              <div className="text-[9px] font-mono uppercase tracking-[0.45em] text-cream/40 mb-2">Analysis</div>
              <p className="text-[13px] font-bold leading-snug text-cream">{interpretation.currentVerdict}</p>
            </div>

            {/* Trajectory */}
            <div className="px-5 py-4">
              <div className="text-[9px] font-mono uppercase tracking-[0.35em] text-cream/40 mb-2">10-Year Trajectory</div>
              <p className="text-[11px] font-mono text-cream/75 capitalize">
                Space economics are{' '}
                <strong className="text-atomic-orange">{interpretation.trajectory}</strong>{' '}
                relative to Earth.
              </p>
            </div>

            {/* Main drivers */}
            {interpretation.mainDrivers.length > 0 && (
              <div className="px-5 py-4">
                <div className="text-[9px] font-mono uppercase tracking-[0.35em] text-cream/40 mb-2.5">Favorable Conditions</div>
                <ul className="space-y-2">
                  {interpretation.mainDrivers.map((d, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-[11px] font-mono text-cream/75">
                      <span className="text-atomic-orange shrink-0 font-bold">→</span>
                      <span className="capitalize">{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Risks */}
            <div className="px-5 py-4">
              <div className="text-[9px] font-mono uppercase tracking-[0.35em] text-cream/40 mb-2.5">Key Risks</div>
              <ul className="space-y-2">
                {interpretation.risks.map((r, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-[11px] font-mono text-cream/70">
                    <span className="text-mustard shrink-0">⚠</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Bottom line */}
            <div className="px-5 py-4">
              <div className="text-[9px] font-mono uppercase tracking-[0.35em] text-atomic-orange/70 mb-2">Bottom Line</div>
              <p className="text-[11px] font-mono text-cream/85 leading-relaxed">{interpretation.bottomLine}</p>
            </div>
          </div>

          {/* Key insight */}
          <div className="border-2 border-atomic-orange/25 bg-atomic-orange/5 px-4 py-3.5">
            <div className="text-[9px] font-mono uppercase tracking-[0.35em] text-atomic-orange/60 mb-1.5">Most Sensitive Variable</div>
            <p className="text-[11px] font-mono text-deep-teal leading-relaxed">
              {sensitivityData[0]?.key === 'hwCostPerPflop'
                ? 'Space hardware cost. No orbital ASICs exist — the economics hinge on ASIC development, not Starship.'
                : sensitivityData[0]?.key === 'launchCostDeclineRate'
                ? 'Launch cost decline rate. Almost entirely a function of Starship achieving its reuse targets.'
                : sensitivityData[0]?.key === 'computeDemandGrowthRate'
                ? 'AI compute demand growth. Faster demand outpacing grid capacity strengthens the space case.'
                : `${sensitivityData[0]?.key} — a ±20% shift moves the 2030 ratio by ${(sensitivityData[0]?.swing * 100).toFixed(1)}%.`
              }
            </p>
          </div>

          {/* Methodology */}
          <div className="border-2 border-deep-teal/12 px-4 py-3.5 bg-white/40">
            <div className="text-[9px] font-mono uppercase tracking-[0.35em] text-deep-teal/40 mb-1.5">Methodology</div>
            <p className="text-[10px] font-mono text-deep-teal/55 leading-relaxed">
              NPV-adjusted levelized cost of compute ($/PFLOP-day, fp16 no-sparsity) over 10 years. Fixed constants from primary sources. ±25% Monte Carlo, 300 runs.
            </p>
          </div>
        </div>

        {/* Mobile interpretation panel */}
        <div className="xl:hidden lg:col-span-2 bg-deep-teal text-cream divide-y divide-cream/10">
          <div className="px-5 pt-5 pb-4">
            <div className="text-[9px] font-mono uppercase tracking-[0.4em] text-cream/40 mb-2">Analysis</div>
            <p className="text-sm font-bold leading-snug text-cream">{interpretation.currentVerdict}</p>
          </div>
          <div className="px-5 py-4">
            <div className="text-[9px] font-mono uppercase tracking-[0.35em] text-atomic-orange/70 mb-1.5">Bottom Line</div>
            <p className="text-[11px] font-mono text-cream/80 leading-relaxed">{interpretation.bottomLine}</p>
          </div>
          <div className="px-5 py-4">
            <div className="text-[9px] font-mono uppercase tracking-[0.35em] text-cream/40 mb-2">Key Risks</div>
            <ul className="space-y-1.5">
              {interpretation.risks.map((r, i) => (
                <li key={i} className="flex gap-2 items-baseline text-[11px] font-mono text-cream/70">
                  <span className="text-mustard shrink-0">⚠</span>{r}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
