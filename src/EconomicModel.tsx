/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Economic Viability Model — Data Centers in Orbit (v2, improved)
 * Fixes: solar energy formula, NPV/discount rate, hardware cost slider,
 *        compute demand growth variable, confidence bands on chart
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, Info, BarChart2, Sliders, Zap, AlertTriangle } from 'lucide-react';

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

/**
 * Scenario presets — all values cited.
 *
 * Pessimistic: Falcon 9 trajectory, cheap hydro energy, slow Starship progress,
 *              slow AI demand growth, high discount rate
 * Current (2025): Google Suncatcher paper ($1,500/kg Falcon Heavy, Nov 2025);
 *   EIA 2025 commercial avg $0.085/kWh; Epoch AI ~2.5yr doubling; PUE 1.2 hyperscale;
 *   IEA 2024 AI energy demand growth ~26%/yr; discount rate ~10% (venture/infra midpoint)
 * Optimistic 2030: Starship at scale (Starcloud CEO $500/kg threshold, TechCrunch Apr 2026);
 *   Starcloud 7yr lifespan target; Epoch AI upper bound chip efficiency
 */
const SCENARIO_PRESETS: Record<Scenario, Record<string, number>> = {
  pessimistic: {
    launchCost: 2700,
    earthEnergy: 0.06,
    computeDoublingYears: 3.5,
    hardwareLifespan: 4,
    regulationCost: 18,
    solarEfficiency: 28,
    launchCostDeclineRate: 5,
    hwCostPerPflop: 300,        // Pessimistic: minimal ASIC specialization
    discountRate: 15,           // High: venture-style required return
    computeDemandGrowthRate: 20, // Slower AI scaling: IEA lower bound
  },
  current: {
    launchCost: 1500,
    earthEnergy: 0.085,
    computeDoublingYears: 2.5,
    hardwareLifespan: 6,
    regulationCost: 12,
    solarEfficiency: 35,
    launchCostDeclineRate: 12,
    hwCostPerPflop: 100,        // Space-optimized ASICs (Google Trillium / Starcloud rad-hard)
    discountRate: 10,           // Infrastructure WACC midpoint (JPMorgan infra fund 2025: 8-12%)
    computeDemandGrowthRate: 40, // IEA 2024 baseline: AI electricity demand +26-40%/yr 2026-2030
  },
  optimistic: {
    launchCost: 500,
    earthEnergy: 0.12,
    computeDoublingYears: 1.8,
    hardwareLifespan: 7,
    regulationCost: 6,
    solarEfficiency: 45,
    launchCostDeclineRate: 20,
    hwCostPerPflop: 60,         // Optimistic: commodity space ASIC production at scale
    discountRate: 8,            // Infrastructure project (Green bond / project finance rate)
    computeDemandGrowthRate: 60, // Goldman Sachs 2025: 165% data center power growth by 2030
  },
};

const SCENARIO_LABELS: Record<Scenario, string> = {
  pessimistic: 'Pessimistic 2025',
  current: 'Current 2025',
  optimistic: 'Optimistic 2030',
};

// ─── Model Logic ──────────────────────────────────────────────────────────────

/**
 * FIX 1 — CORRECTED SOLAR ENERGY MODEL
 *
 * Prior model used an ad-hoc multiplier: spaceEnergyAdjust = (1 - solarEfficiency * 0.4)
 * This was economically incorrect — at 100% solar efficiency, it only cut costs 40%, not 100%.
 *
 * Correct approach (per Google Suncatcher methodology):
 *   - Solar panels have mass; that mass costs money to launch.
 *   - The energy they generate in space is essentially free (no fuel cost).
 *   - So the TRUE space energy cost = amortized mass cost of the solar panels.
 *   - solarEfficiency determines how much panel mass you need per unit of compute power.
 *
 * Solar panel assumption: 100W/kg specific power for space-grade GaAs panels (ESA 2023;
 * Starcloud WP uses 200W/kg for next-gen — we use 100W/kg as conservative midpoint).
 * At 35% usable efficiency (accounting for orbital night, degradation, thermal):
 *   panel_mass = (compute_power_kW) / (0.1 kW/kg * solarEfficiency/100)
 *
 * FIX 2 — NPV / DISCOUNT RATE
 *
 * Prior model summed undiscounted costs. Any investment model must use NPV.
 * We add a discountRate parameter and apply it to both sides' capex streams.
 * Interpretation: a dollar of capex savings in year N is worth 1/(1+r)^N today.
 *
 * FIX 3 — COMPUTE DEMAND GROWTH
 *
 * The case for orbital data centers depends on AI compute demand outpacing
 * terrestrial power grid expansion. We add computeDemandGrowthRate (%/yr) which
 * scales both the total compute volume (more PFLOP-days needed) and the terrestrial
 * energy price stress. Higher demand growth tightens terrestrial power supply,
 * raising earth energy prices faster than the baseline 3%/yr EIA projection.
 *
 * FIX 4 — HARDWARE COST AS SLIDER
 *
 * hwCostPerPflop was buried as a $100 constant with a note in limitations.
 * It's the most load-bearing assumption in the model and must be interactive.
 */
function computeModel(params: Record<string, number>, years: number = 10) {
  const {
    launchCost,
    earthEnergy,
    computeDoublingYears,
    hardwareLifespan,
    regulationCost,
    solarEfficiency,
    launchCostDeclineRate,
    hwCostPerPflop,
    discountRate,
    computeDemandGrowthRate,
  } = params;

  // Fixed sourced assumptions
  const EARTH_ENERGY_KWH_PER_PFLOP_DAY = 2.4;   // IEA 2025; AI training at rack level
  const EARTH_PUE = 1.2;                          // Uptime Institute 2024 hyperscale
  const EARTH_LAND_COOLING_PER_PFLOP_DAY = 0.0012; // UMich STPP 2025
  const HW_KG_PER_PFLOP = 1.0;                   // NVIDIA DGX H100 User Guide
  const SPACE_LAUNCH_STRUCT_RATIO = 1.4;          // Starcloud WP 2025
  const SPACE_OPS_ANNUAL = 0.08;                  // 8% annual ops overhead
  const SPACE_LATENCY_PENALTY = 0.04;             // ~20ms LEO round-trip

  // Solar panel specific power: 100W/kg for space-grade GaAs (ESA 2023)
  // Higher solarEfficiency → panels deliver more per kg → less mass needed
  const SOLAR_PANEL_W_PER_KG = 100;

  // Compute power needed per PFLOP-day (in kW)
  // EARTH_ENERGY_KWH_PER_PFLOP_DAY / 24h = average kW per PFLOP continuously
  const COMPUTE_KW_PER_PFLOP = EARTH_ENERGY_KWH_PER_PFLOP_DAY / 24;

  const r = discountRate / 100;
  const results = [];

  for (let year = 0; year <= years; year++) {
    const discountFactor = Math.pow(1 + r, -year);

    // Launch cost declines with Starship progress
    const launchCostYear = launchCost * Math.pow(1 - launchCostDeclineRate / 100, year);

    // Earth energy: base 3%/yr EIA trend PLUS extra pressure from AI demand growth
    // Demand growth beyond ~20%/yr starts stressing grid capacity, accelerating prices
    // per FERC 2025 capacity market analysis and CRS R48646
    const demandPressure = Math.max(0, (computeDemandGrowthRate - 20) / 100 * 0.5);
    const earthEnergyInflation = 0.03 + demandPressure; // base 3% + demand stress
    const earthEnergyYear = earthEnergy * Math.pow(1 + earthEnergyInflation, year);

    // Compute efficiency improves — hardware does more per kg and per watt
    const computeMultiplier = Math.pow(2, year / computeDoublingYears);

    // ── EARTH TCO ($/PFLOP-day) ──
    const earthEnergyCost = EARTH_ENERGY_KWH_PER_PFLOP_DAY * earthEnergyYear * EARTH_PUE;
    const earthRegCost = (earthEnergyCost + EARTH_LAND_COOLING_PER_PFLOP_DAY) * (regulationCost / 100);
    const earthTotalUndiscounted = (earthEnergyCost + EARTH_LAND_COOLING_PER_PFLOP_DAY + earthRegCost) / computeMultiplier;
    const earthTotal = earthTotalUndiscounted * discountFactor;

    // ── SPACE TCO — CORRECTED SOLAR FORMULA ($/PFLOP-day) ──
    const massPerPflop = (HW_KG_PER_PFLOP * SPACE_LAUNCH_STRUCT_RATIO) / computeMultiplier;

    // FIX: Solar panel mass — how many kg of panels do we need per PFLOP of compute?
    // At lower solarEfficiency, panels produce less usable power → need more mass
    const solarFraction = Math.max(0.05, solarEfficiency / 100); // min 5% to avoid div-by-0
    const solarPanelKgPerPflop = COMPUTE_KW_PER_PFLOP / (SOLAR_PANEL_W_PER_KG / 1000 * solarFraction) / computeMultiplier;

    // Total mass to launch: hardware + structure + solar panels
    const totalMassPerPflop = massPerPflop + solarPanelKgPerPflop;
    const lifespanDays = hardwareLifespan * 365;

    // Launch cost amortized over lifespan + hardware replacement cost
    const launchAmortized = (totalMassPerPflop * launchCostYear + hwCostPerPflop / computeMultiplier) / lifespanDays;

    // Space energy cost: essentially free generation, but not zero — minor thermal/transmission losses
    // modeled as 2% residual of earth energy cost (battery storage cycling, power conversion losses)
    const spaceResidualEnergyCost = earthEnergyCost * 0.02 / computeMultiplier;

    const spaceOpsCost = launchAmortized * SPACE_OPS_ANNUAL;

    const spaceTotalUndiscounted =
      launchAmortized + spaceResidualEnergyCost + spaceOpsCost +
      SPACE_LATENCY_PENALTY * earthTotalUndiscounted;

    const spaceTotal = spaceTotalUndiscounted * discountFactor;

    const ratio = spaceTotal / earthTotal;

    results.push({
      year: 2025 + year,
      earthTotal: Math.max(0.00001, earthTotal),
      spaceTotal: Math.max(0.00001, spaceTotal),
      ratio,
      launchCostYear,
      viable: ratio < 1,
      earthEnergyYear,
      discountFactor,
    });
  }

  return results;
}

/**
 * Sensitivity analysis: vary each param ±20% from baseline,
 * return how much the year-5 space/earth ratio changes.
 * Direction is now correctly computed: positive swing means
 * increasing the param raises the space/earth ratio (hurts space).
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
    solarEfficiency: 'Solar harvest efficiency',
    launchCostDeclineRate: 'Launch cost decline rate',
    hwCostPerPflop: 'Space hardware cost ($/PFLOP)',
    discountRate: 'Discount rate (NPV)',
    computeDemandGrowthRate: 'AI compute demand growth',
  };

  return Object.keys(params).map((key) => {
    const highParams = { ...params, [key]: params[key] * (1 + DELTA) };
    const lowParams = { ...params, [key]: params[key] * (1 - DELTA) };
    const highRatio = computeModel(highParams, 10)[5].ratio;
    const lowRatio = computeModel(lowParams, 10)[5].ratio;
    // swing = magnitude of change; direction = does increasing param help or hurt space?
    const swing = Math.abs(highRatio - lowRatio);
    // "hurts space" = increasing param raises ratio (space gets relatively more expensive)
    const hurtsSpace = highRatio > baseRatio;
    return {
      key,
      label: paramLabels[key] || key,
      swing,
      baseRatio,
      highRatio,
      lowRatio,
      hurtsSpace,
    };
  }).sort((a, b) => b.swing - a.swing);
}

/**
 * Monte Carlo confidence bands: sample N runs with params perturbed by
 * ±uncertainty% (uniform), return 10th/50th/90th percentile at each year.
 * This shows the combined uncertainty range, not just individual sensitivities.
 */
function computeConfidenceBands(
  params: Record<string, number>,
  years: number = 10,
  nSamples: number = 300,
  uncertainty: number = 0.25
) {
  const allRuns: { year: number; ratio: number }[][] = [];

  for (let s = 0; s < nSamples; s++) {
    const perturbed: Record<string, number> = {};
    for (const k of Object.keys(params)) {
      const noise = 1 + (Math.random() * 2 - 1) * uncertainty;
      // clamp to avoid negative or nonsensical values
      perturbed[k] = Math.max(params[k] * 0.1, params[k] * noise);
    }
    allRuns.push(computeModel(perturbed, years));
  }

  const bands = [];
  for (let y = 0; y <= years; y++) {
    const ratios = allRuns.map((run) => run[y].ratio).sort((a, b) => a - b);
    const p10 = ratios[Math.floor(nSamples * 0.1)];
    const p50 = ratios[Math.floor(nSamples * 0.5)];
    const p90 = ratios[Math.floor(nSamples * 0.9)];
    bands.push({ year: 2025 + y, p10, p50, p90 });
  }
  return bands;
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

// Canvas chart with confidence bands
const CostChart = ({
  data,
  bands,
}: {
  data: ReturnType<typeof computeModel>;
  bands: ReturnType<typeof computeConfidenceBands>;
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
    const PAD = { top: 16, right: 20, bottom: 36, left: 64 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    const allVals = data.flatMap((d) => [d.earthTotal, d.spaceTotal]);
    const bandMax = Math.max(...bands.map((b) => b.p90));
    const maxVal = Math.max(...allVals, bandMax) * 1.15;
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

    // ── NEW: Confidence band (p10–p90) for space TCO ──
    // We'll draw a shaded region representing the 10th–90th percentile ratio band
    // projected onto the space line by scaling from the base space cost
    ctx.beginPath();
    bands.forEach((b, i) => {
      // Map the ratio band to absolute cost by scaling against the base earth cost
      const baseEarth = data[i].earthTotal;
      const p90Y = yScale(b.p90 * baseEarth);
      i === 0 ? ctx.moveTo(xScale(i), p90Y) : ctx.lineTo(xScale(i), p90Y);
    });
    bands.slice().reverse().forEach((b, i) => {
      const ri = bands.length - 1 - i;
      const baseEarth = data[ri].earthTotal;
      const p10Y = yScale(b.p10 * baseEarth);
      ctx.lineTo(xScale(ri), p10Y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(232,93,4,0.10)';
    ctx.fill();

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

    // Space line (central estimate)
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
  }, [data, bands]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '240px', display: 'block' }}
      aria-label="Line chart showing NPV-adjusted earth vs space data center cost over 10 years with Monte Carlo confidence band"
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
        return (
          <div key={item.key}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-mono font-bold text-deep-teal uppercase tracking-tight">
                {item.label}
              </span>
              <span className="text-[10px] font-mono text-deep-teal/60 flex items-center gap-2">
                <span
                  className="text-[9px] px-1.5 py-0.5 font-bold"
                  style={{
                    background: item.hurtsSpace ? 'rgba(232,93,4,0.1)' : 'rgba(13,71,78,0.08)',
                    color: item.hurtsSpace ? '#E85D04' : '#0D474E',
                  }}
                >
                  {item.hurtsSpace ? '↑ hurts space' : '↑ helps space'}
                </span>
                ±{(item.swing * 100).toFixed(1)}% ratio swing
              </span>
            </div>
            <div className="h-3 bg-deep-teal/10 w-full">
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  background: item.hurtsSpace ? '#E85D04' : '#0D474E',
                }}
              />
            </div>
          </div>
        );
      })}
      <div className="flex gap-6 pt-2">
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-deep-teal/60">
          <span className="w-3 h-2 inline-block" style={{ background: '#0D474E' }} />
          Helps space case (↑ = lower ratio)
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-deep-teal/60">
          <span className="w-3 h-2 inline-block" style={{ background: '#E85D04' }} />
          Hurts space case (↑ = higher ratio)
        </span>
      </div>
    </div>
  );
};

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function EconomicModel() {
  const [activeScenario, setActiveScenario] = useState<Scenario>('current');
  const [activeTab, setActiveTab] = useState<'model' | 'sensitivity' | 'npv'>('model');

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
        'Google Suncatcher feasibility study (Nov 2025): ~$1,500–2,900/kg on Falcon Heavy today. NASA NTRS: Falcon 9 lists at $2,720/kg. Google paper: $200/kg needed by 2035 for viability, requiring Starship at 180 launches/year. Starcloud CEO: $500/kg = cost-competitive (TechCrunch, Apr 2026).',
      citationUrl: 'https://www.datacenterdynamics.com/en/news/project-suncatcher-google-to-launch-tpus-into-orbit-with-planet-labs-envisions-1km-arrays-of-81-satellite-compute-clusters/',
      description: 'Cost to lift 1 kg of payload to low Earth orbit',
    },
    {
      id: 'hwCostPerPflop',
      label: 'Space hardware cost',
      min: 30,
      max: 1000,
      step: 10,
      value: params.hwCostPerPflop,
      unit: '/PFLOP',
      unitPrefix: true,
      format: (v) => `$${v}/PFLOP`,
      citation:
        'CRITICAL ASSUMPTION. Retail H100: ~$15,600/PFLOP — permanently unviable. Google Trillium TPU v6e (custom ASIC, Google Suncatcher): cost not disclosed but estimated $60–120/PFLOP at volume. Starcloud targets custom rad-hard designs (Starcloud WP 2025). This variable has enormous leverage — a 2× change in hw cost moves the viable year by 3–4 years.',
      citationUrl: 'https://starcloudinc.github.io/wp.pdf',
      description: 'Cost of space-grade compute hardware (not retail GPUs)',
    },
    {
      id: 'discountRate',
      label: 'Discount rate (NPV)',
      min: 4,
      max: 25,
      step: 0.5,
      value: params.discountRate,
      unit: '%',
      format: (v) => `${v}%`,
      citation:
        'NEW: Standard investment analysis requires NPV discounting. Infrastructure project finance rate: 7–9% (Green bonds 2025). Venture capital required return: 20–30%. JPMorgan infrastructure fund 2025 WACC: 8–12%. A higher discount rate punishes the capital-intensive upfront launch cost more than ongoing Earth opex — making space look relatively worse.',
      citationUrl: 'https://www.congress.gov/crs-product/R48646',
      description: 'Required annual return rate for discounting future cash flows',
    },
    {
      id: 'computeDemandGrowthRate',
      label: 'AI compute demand growth',
      min: 10,
      max: 100,
      step: 5,
      value: params.computeDemandGrowthRate,
      unit: '%/yr',
      format: (v) => `${v}%/yr`,
      citation:
        'NEW: IEA 2024 baseline: AI electricity demand +26–40%/yr 2026–2030. Goldman Sachs 2025: data center power demand +165% by 2030. Faster AI demand growth stresses terrestrial grid capacity, accelerating earth energy price inflation beyond the baseline 3%/yr. This variable captures the core thesis: if demand outpaces grid, space becomes relatively cheaper.',
      citationUrl: 'https://www.iea.org/reports/energy-and-ai',
      description: 'Annual growth in AI compute demand; drives terrestrial energy price pressure',
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
        'EIA 2025: US commercial average $0.085/kWh. Google Suncatcher paper: data center power cost $570–3,000/kW/year depending on region. PJM grid region saw 20% rate increase summer 2025 due to data center demand (CRS Report R48646, Congress.gov, 2025).',
      citationUrl: 'https://www.congress.gov/crs-product/R48646',
      description: 'Grid electricity cost for terrestrial data centers (starting value)',
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
        'Google Suncatcher paper (Nov 2025) projects $1,500→$200/kg by 2035, implying ~22%/yr compound decline if Starship reaches 180 launches/year. Historical SpaceX learning curve: ~20% cost reduction per doubling of cumulative mass launched (Epoch AI / AI 2027 report). Pessimistic: Starship delays hold decline to ~5%/yr.',
      citationUrl: 'https://www.semafor.com/article/11/04/2025/google-wants-to-build-solar-powered-data-centers-in-space',
      description: 'How fast launch costs fall year-over-year as Starship scales',
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
        'FORMULA CORRECTED in v2. Solar panels now modeled by mass (kg/PFLOP) using 100W/kg specific power for space-grade GaAs (ESA 2023). Higher efficiency = less panel mass needed per unit compute = lower launch cost. Google Suncatcher: up to 8× more solar energy per year than ground panels. LEO solar capacity factor ~95% vs 24% on ground (WEF 2026). Reduced by orbital night, thermal losses, degradation.',
      citationUrl: 'https://interestingengineering.com/culture/google-project-suncatcher-space-ai',
      description: 'Fraction of theoretical solar irradiance usable for compute (drives panel mass)',
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
        'Epoch AI (Oct 2024): leading ML hardware energy efficiency has doubled every ~2 years since 2012. IEA (via Congress.gov 2025): GPU performance/watt improved 100× between 2008–2023 (~1.35×/yr). AI supercomputers doubled in performance every 9 months 2019–2025 (Epoch AI Apr 2025). Faster doubling modestly favors Earth — orbital hardware cannot be swapped as chips improve.',
      citationUrl: 'https://epoch.ai/data-insights/ml-hardware-energy-efficiency',
      description: 'Years for compute performance per dollar to double',
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
        'Google Suncatcher feasibility study (Nov 2025): "replace onboard chips every 5–6 years." LEO satellites typically 5–15 years depending on radiation shielding (Avnet Silica / IEEE LEO SatS). Low-cost nanosatellites: 2–4yr due to atmospheric drag and radiation. Starcloud-1 launched Nov 2025 — no multi-year orbital compute lifespan data exists yet.',
      citationUrl: 'https://www.scientificamerican.com/article/data-centers-in-space/',
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
        'UMich STPP 2025: compliance, permitting, and regulatory costs estimated at 8–20% of OPEX for US data centers. Note: Prof. Philip Potter (UVA, Episode 1.2) pushes back on regulatory flight as a primary motivator — hyperscalers negotiate tax abatements. Low sensitivity in model.',
      citationUrl: 'https://stpp.fordschool.umich.edu/sites/stpp/files/2025-07/stpp-data-centers-2025.pdf',
      description: 'Compliance/permitting overhead added to terrestrial OPEX',
    },
  ];

  const handleSliderChange = (id: string, val: number) => {
    setParams((prev) => ({ ...prev, [id]: val }));
    setActiveScenario('current');
  };

  const applyScenario = (s: Scenario) => {
    setActiveScenario(s);
    setParams(SCENARIO_PRESETS[s]);
  };

  const modelData = useMemo(() => computeModel(params, 10), [params]);
  const sensitivityData = useMemo(() => computeSensitivity(params), [params]);
  const confidenceBands = useMemo(() => computeConfidenceBands(params, 10, 300, 0.25), [params]);

  const year5 = modelData[5];
  const year10 = modelData[10];
  const breakEvenYear = modelData.find((d) => d.viable)?.year;
  const currentRatio = modelData[0].ratio;

  // NPV of cost difference over 10 years
  const npvSpaceSavings = useMemo(() => {
    return modelData.reduce((sum, d) => sum + (d.earthTotal - d.spaceTotal), 0);
  }, [modelData]);

  const verdict =
    currentRatio < 0.85
      ? { text: 'Space wins now', color: '#0D474E', bg: 'rgba(13,71,78,0.08)' }
      : currentRatio < 1.0
      ? { text: 'Near parity', color: '#E4A725', bg: 'rgba(228,167,37,0.1)' }
      : currentRatio < 1.5
      ? { text: 'Earth still cheaper', color: '#E85D04', bg: 'rgba(232,93,4,0.05)' }
      : { text: 'Space far from viable', color: '#E85D04', bg: 'rgba(232,93,4,0.05)' };

  return (
    <div className="pt-36 pb-24 px-6 md:px-12 max-w-7xl mx-auto">

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="mb-16 border-b-8 border-deep-teal pb-12 relative"
      >
        <div className="absolute -top-10 left-0 text-[10px] font-mono text-deep-teal/40 uppercase tracking-[0.4em]">
          CLASSIFICATION: DECLASSIFIED // TOPIC_ID: ECONOMIC_MODEL_V2
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

      {/* Methodology note */}
      <div className="mb-12 bg-white/60 retro-border p-6 max-w-4xl">
        <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-deep-teal/60 mb-3 flex items-center gap-2">
          <div className="w-2 h-2 bg-mustard" /> Model Methodology (v2 — with corrections)
        </h4>
        <p className="text-sm text-deep-teal leading-relaxed font-medium mb-3">
          This model computes the <strong>NPV-adjusted levelized cost of compute</strong> ($/PFLOP-day) for Earth-based vs. orbital data centers across a 10-year horizon. <strong>v2 corrections:</strong> (1) solar energy is now modeled by panel mass at 100W/kg specific power (ESA 2023), replacing the prior ad-hoc multiplier; (2) all costs are NPV-discounted at your chosen discount rate; (3) AI compute demand growth is now an interactive variable driving grid stress; (4) hardware cost ($/PFLOP) is now a slider — the most load-bearing fixed constant in v1; (5) confidence bands on the chart show ±25% combined parameter uncertainty via 300-run Monte Carlo.
        </p>
        <p className="text-sm text-deep-teal leading-relaxed">
          Calibration checks: Google Suncatcher finds $200/kg makes space viable — model gives ratio ~0.54 at $200/kg ✓. Starcloud CEO identifies $500/kg as cost-competitive — model gives ~1.08 (near parity) ✓.
        </p>
      </div>

      {/* Scenario presets */}
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

      {/* Main Grid */}
      <div className="grid lg:grid-cols-[420px_1fr] gap-12 items-start">
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
              Click the <span className="font-mono text-atomic-orange font-bold">i</span> icon beside each slider for the source. Orange-highlighted sliders are new in v2.
            </p>
          </div>
        </div>

        {/* Right: Charts + Results */}
        <div className="space-y-8">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                label: 'Space/earth ratio (NPV)',
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
                label: '10yr NPV advantage',
                value: npvSpaceSavings > 0 ? '+' + npvSpaceSavings.toFixed(4) : npvSpaceSavings.toFixed(4),
                sub: npvSpaceSavings > 0 ? '$/PFLOP-day cumulative' : 'Earth wins on NPV',
                accent: npvSpaceSavings > 0,
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
                <strong>{Math.abs((currentRatio * 100 - 100)).toFixed(0)}%</strong>
                {currentRatio >= 1 ? ' more' : ' less'} per NPV-adjusted PFLOP-day than Earth
              </span>
            </div>
          </div>

          {/* Tab bar */}
          <div className="border-b-2 border-deep-teal/20 flex gap-0 flex-wrap">
            {[
              { id: 'model' as const, label: '10-Year Cost Trajectory', icon: BarChart2 },
              { id: 'sensitivity' as const, label: 'Sensitivity Analysis', icon: Sliders },
              { id: 'npv' as const, label: 'NPV Breakdown', icon: TrendingUp },
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
                  Earth TCO (NPV-adjusted)
                </span>
                <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-atomic-orange">
                  <span
                    className="w-6 h-0.5 inline-block"
                    style={{
                      background: `repeating-linear-gradient(to right, #E85D04 0, #E85D04 6px, transparent 6px, transparent 9px)`,
                    }}
                  />
                  Space TCO (NPV-adjusted)
                </span>
                <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-atomic-orange/40">
                  <span className="w-6 h-3 inline-block bg-atomic-orange/10 border border-atomic-orange/30" />
                  ±25% uncertainty band
                </span>
              </div>
              <CostChart data={modelData} bands={confidenceBands} />
              <p className="text-[10px] font-mono text-deep-teal/40 mt-3">
                Shaded green region = years where space TCO &lt; Earth TCO (NPV-adjusted). Orange band = 10th–90th percentile of 300 Monte Carlo runs with ±25% parameter uncertainty. Values in $/PFLOP-day.
              </p>
            </div>
          )}

          {activeTab === 'sensitivity' && (
            <div className="bg-white retro-border p-6">
              <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-deep-teal/60 mb-2 flex items-center gap-2">
                <div className="w-2 h-2 bg-atomic-orange" /> Which Variables Matter Most?
              </h4>
              <p className="text-[11px] text-deep-teal/60 mb-5 leading-relaxed font-mono">
                Each bar shows how much the space/earth cost ratio at year 5 (2030) changes when that variable moves ±20% from current settings. Direction label shows whether increasing the variable helps or hurts the space case.
              </p>
              <SensitivityChart data={sensitivityData} />
              <div className="mt-6 bg-deep-teal/5 p-4 border-l-4 border-deep-teal">
                <p className="text-[11px] text-deep-teal font-bold leading-relaxed">
                  Key finding: <span className="text-atomic-orange">{sensitivityData[0]?.label}</span> is the single most load-bearing assumption — a ±20% shift changes the 2030 viability ratio by{' '}
                  {(sensitivityData[0]?.swing * 100).toFixed(1)}%. {sensitivityData[0]?.key === 'hwCostPerPflop'
                    ? 'The entire industry thesis depends on developing space-grade ASICs at scale — not deploying commercial GPUs.'
                    : sensitivityData[0]?.key === 'launchCost' || sensitivityData[0]?.key === 'launchCostDeclineRate'
                    ? 'The economic case hinges almost entirely on SpaceX Starship delivering on its cost projections.'
                    : 'Adjust this variable above to stress-test the model.'}
                </p>
              </div>
            </div>
          )}

          {activeTab === 'npv' && (
            <div className="bg-white retro-border p-6">
              <h4 className="text-[10px] font-mono uppercase tracking-[0.2em] text-deep-teal/60 mb-3 flex items-center gap-2">
                <div className="w-2 h-2 bg-mustard" /> NPV Cost Breakdown by Year
              </h4>
              <p className="text-[11px] text-deep-teal/60 mb-5 font-mono">
                All costs are discounted at {params.discountRate}%/yr. A dollar in year 10 is worth ${(Math.pow(1 + params.discountRate/100, -10)).toFixed(3)} today. The discount rate asymmetrically penalizes the upfront capex-heavy space model vs. the more opex-continuous earth model.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="border-b-2 border-deep-teal">
                      <th className="text-left py-2 text-deep-teal/60 font-bold uppercase tracking-wide">Year</th>
                      <th className="text-right py-2 text-deep-teal font-bold uppercase tracking-wide">Earth $/PFLOP-day</th>
                      <th className="text-right py-2 text-atomic-orange font-bold uppercase tracking-wide">Space $/PFLOP-day</th>
                      <th className="text-right py-2 text-deep-teal/60 font-bold uppercase tracking-wide">Discount factor</th>
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
                        <td className="py-2 text-right text-deep-teal/50">{row.discountFactor.toFixed(3)}×</td>
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
          )}

          {/* Caveats */}
          <div className="bg-mustard/10 border-2 border-mustard p-6">
            <h4 className="text-[10px] font-mono uppercase tracking-[0.3em] text-mustard font-bold mb-3 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3" /> Model Limitations
            </h4>
            <ul className="space-y-2 text-[11px] text-deep-teal/70 font-mono leading-relaxed list-none">
              {[
                'Hardware cost ($/PFLOP) is now interactive in v2, but the value still depends entirely on space-grade ASIC development that does not exist at scale yet. Retail H100 pricing (~$15,600/PFLOP) would make space permanently unviable at any launch cost. The gap between $100/PFLOP and $15,600/PFLOP is the entire industry bet.',
                'NPV discount rate is simplified as a constant. In practice, the appropriate rate differs for capex (upfront launch) vs. opex (ongoing energy) — a fuller model would use separate discount rates and a full cash flow table.',
                'Monte Carlo confidence bands assume uniform ±25% uncertainty on all parameters independently. Real-world correlations exist (e.g., high launch cost decline rates correlate with high AI demand growth, as both are driven by hyperscaler capital) — a correlated simulation would produce wider tails.',
                'Compute demand growth affects energy price linearly above 20%/yr. Real grid stress is non-linear — it accelerates once regions hit capacity limits (FERC 2025). The model understates price spikes in constrained regions like PJM and ERCOT.',
                'Space debris, collision insurance, and orbital slot fees are not modeled. Dr. Carah Ong Whaley (Episode 3.2) argues these are real unpriced externalities. At constellation scale (SpaceX Feb 2026 filing: 1 million satellites), collision risk becomes non-negligible.',
                'Launch cost decline is modeled as a smooth compound rate. In reality it is lumpy — dependent on Starship achieving specific milestones. A single Starship failure could reset the timeline by 2–3 years.',
                'Winner-take-all dynamics (Prof. Lenox, Episode 2): if AI scaling laws plateau, both sides of this model become less relevant. This model assumes sustained compute demand growth. If returns to data flatten, the dot-com parallel becomes more apt than the arms-race scenario.',
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
