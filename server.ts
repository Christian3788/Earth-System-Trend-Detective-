import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { Content, GenerateContentResponse } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface IncomingChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface TelemetryContext {
  dataModeLabel?: string;
  dataMode?: string;
  year?: number;
  monthLabel?: string;
  datasetName?: string;
  mission?: string;
  sourceType?: string;
  unit?: string;
  daacName?: string;
  portalHint?: string;
  teleconnectionLabel?: string;
  teleconnectionMechanism?: string;
  boundingCoords?: string;
  slopePerDecade?: string;
  horizonDelta?: string;
  zScore?: string;
  pValue?: string;
  significant?: boolean;
  confidenceLabel?: string;
  poleASummary?: string;
  poleBSummary?: string;
  historicalSlopeComparison?: string;
  probedSummary?: string;
  pettittSummary?: string;
  roiSummary?: string;
  correlationSummary?: string;
  customCsvSummary?: string;
}

interface ChatRequestBody {
  messages?: IncomingChatMessage[];
  context?: TelemetryContext;
  mode?: 'general' | 'fast';
}

const PORT = Number(process.env.PORT) || 3000;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildSystemInstruction(ctx?: TelemetryContext): string {
  const contextBlock = ctx
    ? [
        `Active Data Mode: ${ctx.dataModeLabel ?? 'Historical Observed (2005–2024)'}`,
        `Active Date: ${ctx.monthLabel ?? 'Oct'} ${ctx.year ?? 2024}`,
        `Selected Variable: ${ctx.datasetName ?? 'Surface Air Temperature (MERRA-2)'} (${ctx.sourceType ?? 'Earth System Model'}, ${ctx.mission ?? 'MERRA-2'})`,
        `Unit & Archive: ${ctx.unit ?? '°C'} | DAAC/Partner: ${ctx.daacName ?? 'NASA GES DISC'} | Portals: ${ctx.portalHint ?? 'NASA Giovanni'}`,
        `Teleconnection Driver: ${ctx.teleconnectionLabel ?? 'Indian Ocean Dipole (IOD)'} [${ctx.boundingCoords ?? 'Global'}]`,
        ctx.teleconnectionMechanism ? `Physical Mechanism: ${ctx.teleconnectionMechanism}` : '',
        `Trend Detective Stats: Slope = ${ctx.slopePerDecade ?? 'N/A'}, Window Delta = ${ctx.horizonDelta ?? 'N/A'}, Mann-Kendall Z = ${ctx.zScore ?? 'N/A'}, p = ${ctx.pValue ?? 'N/A'} (${ctx.significant ? 'Statistically Significant p < 0.05' : 'Non-Significant p >= 0.05'}, ${ctx.confidenceLabel ?? ''})`,
        ctx.poleASummary ? `Pole A (Surplus): ${ctx.poleASummary}` : '',
        ctx.poleBSummary ? `Pole B (Deficit): ${ctx.poleBSummary}` : '',
        ctx.historicalSlopeComparison ? `Observed vs Projected Comparison: ${ctx.historicalSlopeComparison}` : '',
        ctx.probedSummary ? `User Probed Coordinate: ${ctx.probedSummary}` : '',
        ctx.pettittSummary ? `Pettitt Change-Point Test: ${ctx.pettittSummary}` : '',
        ctx.roiSummary ? `Active Area-Weighted Region (ROI): ${ctx.roiSummary}` : '',
        ctx.correlationSummary ? `Cross-Sphere Correlation: ${ctx.correlationSummary}` : '',
        ctx.customCsvSummary ? `Uploaded External CSV Series: ${ctx.customCsvSummary}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : 'No active telemetry snapshot provided.';

  return [
    'You are the NASA Earth System Trend Detective Assistant, an institutional Earth science analyst embedded inside the NASA Earth System Data Explorer (ESDE) workbench.',
    'Your role is to help scientists, students, and NASA Space Apps Challenge participants investigate:',
    '1. What is changing (distinguishing Satellite Mission observations from Earth System Model / Reanalysis assimilation and CMIP5 RCP 4.5 / 8.5 climate projections).',
    '2. Where it is changing (including opposing dipole teleconnections like IOD, Pacific ENSO, and Arctic Amplification where one physical process drives opposite regional trends).',
    '3. How much it is changing (Theil-Sen decadal slopes, 20-year observed deltas vs. 75-year projected deltas).',
    '4. Whether changes are statistically significant (Mann-Kendall Z-score, two-tailed p-value at alpha = 0.05, LOESS smoothing vs. synoptic noise).',
    'Always ground your answers in the live telemetry snapshot below, citing the active dataset, units, coordinates, and statistical values accurately. When helpful, reference operational portals such as NASA Giovanni, Hydrology Time Series, AppEEARS, NOAA CDO, SWOT, CSA RADARSAT RCM / GEO.ca, and KNMI Climate Explorer.',
    'Keep answers crisp, scientifically accurate, and well-structured using short paragraphs or bullet points.',
    '',
    '--- LIVE WORKBENCH TELEMETRY ---',
    contextBlock,
  ].join('\n');
}

function sendSse(res: Response, payload: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/chat', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as ChatRequestBody;
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];

    if (rawMessages.length === 0) {
      res.status(400).json({ error: 'At least one user message is required.' });
      return;
    }

    const lastMsg = rawMessages[rawMessages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || !lastMsg.text?.trim()) {
      res.status(400).json({ error: 'The latest message must be a non-empty user prompt.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets to enable Trend Detective AI.',
      });
      return;
    }

    const modelName =
      body.mode === 'fast' ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';
    const thinkingLevel =
      body.mode === 'fast' ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;

    const history: Content[] = rawMessages
      .slice(0, -1)
      .filter((m) => m.text && m.text.trim().length > 0)
      .map((m) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.text }],
      }));

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      const chat = ai.chats.create({
        model: modelName,
        history,
        config: {
          systemInstruction: buildSystemInstruction(body.context),
          thinkingConfig: { thinkingLevel },
        },
      });

      const stream = await chat.sendMessageStream({
        message: lastMsg.text.trim(),
      });

      for await (const chunk of stream) {
        const c = chunk as GenerateContentResponse;
        if (c.text) {
          sendSse(res, { delta: c.text });
        }
      }

      sendSse(res, { done: true, model: modelName });
      res.end();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unexpected Gemini API error.';
      let friendly = msg;
      if (/403|PERMISSION_DENIED|API_KEY_INVALID/i.test(msg)) {
        friendly =
          'Gemini API authentication failed. Please check your GEMINI_API_KEY in Settings > Secrets.';
      } else if (/429|RESOURCE_EXHAUSTED/i.test(msg)) {
        friendly =
          'Gemini API rate or quota limit reached. Please retry shortly or check quota in Settings > Secrets.';
      }
      sendSse(res, { error: friendly });
      res.end();
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Production bundle not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NASA ESDE Trend Detective server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
