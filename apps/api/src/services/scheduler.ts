import { prisma } from "../db.js";
import { resumeDueRuns } from "../automation/engine.js";
import { launchCampaign, processCampaignBatch } from "./campaigns.js";

const TICK_SECONDS = 5;
let timer: NodeJS.Timeout | null = null;
let busy = false;

/**
 * Un ciclo del planificador: campañas programadas, lotes de envío y workflows en espera.
 * `elapsedSeconds` dimensiona el lote de cada campaña según su límite por minuto.
 */
export async function tick(elapsedSeconds = TICK_SECONDS) {
  if (busy) return;
  busy = true;
  try {
    const due = await prisma.campaign.findMany({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } } });
    for (const c of due) await launchCampaign(c).catch((e) => console.error("[scheduler] launch", c.id, e.message));

    const runningCampaigns = await prisma.campaign.findMany({ where: { status: "RUNNING" } });
    await Promise.all(runningCampaigns.map((c) => processCampaignBatch(c, elapsedSeconds)));

    await resumeDueRuns();
  } catch (e) {
    console.error("[scheduler]", e);
  } finally {
    busy = false;
  }
}

export function startScheduler() {
  timer ??= setInterval(() => void tick(), TICK_SECONDS * 1000);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
