import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Send, Sparkles, Square, Trash2, User, Zap } from 'lucide-react';
import {
  DATA_MODE_META,
  DataMode,
  DatasetSpec,
  MONTH_ABBR,
  TELECONNECTIONS,
  TeleconnectionId,
  getEffectivePoles,
} from '../data/datasets';
import { formatCoord } from '../data/worldCoastlines';
import { TrendAnalysisResult, formatPValue } from '../engine/statistics';

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  modelName?: string;
}

interface ChatbotPanelProps {
  messages: ChatMessage[];
  onChangeMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  dataset: DatasetSpec;
  teleconnectionId: TeleconnectionId;
  dataMode: DataMode;
  year: number;
  month: number;
  driverStats: TrendAnalysisResult;
  poleAVal: number | null;
  poleBVal: number | null;
  poleBStats: TrendAnalysisResult | null;
  historicalSlope: number | null;
  probedInfo: {
    lat: number;
    lon: number;
    region: string;
    observed: number;
    domainMasked: boolean;
    stats: TrendAnalysisResult | null;
  } | null;
  pendingPrompt?: string | null;
  onClearPendingPrompt?: () => void;
}

type ChatModelMode = 'general' | 'fast';

function renderInlineFormatting(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={i}
          className="px-1 py-0.5 rounded bg-slate-200/70 text-[#0B3D91] font-mono text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

function FormattedMessage({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-slate-700">
      {lines.map((rawLine, idx) => {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
          return <div key={idx} className="h-1" />;
        }
        const bulletMatch = line.match(/^\s*[-*•]\s+(.*)$/);
        if (bulletMatch) {
          return (
            <div key={idx} className="flex items-start gap-1.5 pl-1">
              <span className="text-[#0B3D91] font-bold mt-0.5" aria-hidden="true">
                ·
              </span>
              <span>{renderInlineFormatting(bulletMatch[1])}</span>
            </div>
          );
        }
        const numMatch = line.match(/^\s*(\d+\.)\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-1.5 pl-0.5">
              <span className="font-mono font-semibold text-[#0B3D91] shrink-0">
                {numMatch[1]}
              </span>
              <span>{renderInlineFormatting(numMatch[2])}</span>
            </div>
          );
        }
        return <p key={idx}>{renderInlineFormatting(line)}</p>;
      })}
    </div>
  );
}

export const ChatbotPanel: React.FC<ChatbotPanelProps> = ({
  messages,
  onChangeMessages,
  dataset,
  teleconnectionId,
  dataMode,
  year,
  month,
  driverStats,
  poleAVal,
  poleBVal,
  poleBStats,
  historicalSlope,
  probedInfo,
  pendingPrompt,
  onClearPendingPrompt,
}) => {
  const [input, setInput] = useState('');
  const [modelMode, setModelMode] = useState<ChatModelMode>('general');
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const tele = TELECONNECTIONS[teleconnectionId];
  const modeMeta = DATA_MODE_META[dataMode];
  const effectivePoles = useMemo(
    () => getEffectivePoles(teleconnectionId, dataset),
    [teleconnectionId, dataset]
  );

  const formatSigned = (v: number, dec = dataset.decimals) =>
    `${v >= 0 ? '+' : ''}${v.toFixed(dec)}`;

  // Build live telemetry snapshot sent to Gemini server route
  const telemetryContext = useMemo(() => {
    const poleASummary =
      effectivePoles.poleA && poleAVal !== null && !Number.isNaN(poleAVal)
        ? `${effectivePoles.poleA.name} (${formatCoord(effectivePoles.poleA.lat, effectivePoles.poleA.lon)}): ${formatSigned(poleAVal)} ${dataset.unit}, Slope ${formatSigned(driverStats.slopePerDecade)} ${dataset.unit}/dec`
        : undefined;

    const poleBSummary =
      effectivePoles.poleB && poleBVal !== null && !Number.isNaN(poleBVal) && poleBStats
        ? `${effectivePoles.poleB.name} (${formatCoord(effectivePoles.poleB.lat, effectivePoles.poleB.lon)}): ${formatSigned(poleBVal)} ${dataset.unit}, Slope ${formatSigned(poleBStats.slopePerDecade)} ${dataset.unit}/dec, Z=${poleBStats.zScore.toFixed(2)}, p=${formatPValue(poleBStats.pValue)}`
        : undefined;

    const historicalSlopeComparison =
      dataMode !== 'historical' && historicalSlope !== null
        ? `Historical (2005–2024) slope = ${formatSigned(historicalSlope)} ${dataset.unit}/dec vs. ${modeMeta.shortLabel} (2025–2099) slope = ${formatSigned(driverStats.slopePerDecade)} ${dataset.unit}/dec`
        : undefined;

    const probedSummary = probedInfo
      ? probedInfo.domainMasked
        ? `${formatCoord(probedInfo.lat, probedInfo.lon)} (${probedInfo.region}) — Domain Masked (${dataset.domain}-only dataset)`
        : `${formatCoord(probedInfo.lat, probedInfo.lon)} (${probedInfo.region}): Anomaly ${formatSigned(probedInfo.observed)} ${dataset.unit}, Slope ${probedInfo.stats ? formatSigned(probedInfo.stats.slopePerDecade) : 'N/A'} ${dataset.unit}/dec, Z=${probedInfo.stats?.zScore.toFixed(2) ?? 'N/A'}, p=${probedInfo.stats ? formatPValue(probedInfo.stats.pValue) : 'N/A'}`
      : undefined;

    return {
      dataMode,
      dataModeLabel: modeMeta.label,
      year,
      monthLabel: MONTH_ABBR[month - 1],
      datasetName: dataset.name,
      mission: dataset.mission,
      sourceType: dataset.sourceType,
      unit: dataset.unit,
      daacName: dataset.daacName,
      portalHint: dataset.portalHint,
      teleconnectionLabel: tele.label,
      teleconnectionMechanism: tele.mechanism,
      boundingCoords: tele.boundingCoords,
      slopePerDecade: `${formatSigned(driverStats.slopePerDecade)} ${dataset.unit}/decade`,
      horizonDelta: `${formatSigned(driverStats.delta20Yr)} ${dataset.unit} (${dataMode === 'historical' ? '2005–2024' : '2025–2099'})`,
      zScore: `${driverStats.zScore >= 0 ? '+' : ''}${driverStats.zScore.toFixed(2)}`,
      pValue: formatPValue(driverStats.pValue),
      significant: driverStats.significant,
      confidenceLabel: driverStats.confidenceLabel,
      poleASummary,
      poleBSummary,
      historicalSlopeComparison,
      probedSummary,
    };
  }, [
    dataMode,
    modeMeta,
    year,
    month,
    dataset,
    tele,
    effectivePoles,
    poleAVal,
    poleBVal,
    poleBStats,
    driverStats,
    historicalSlope,
    probedInfo,
  ]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isStreaming]);

  const sendMessage = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || isStreaming) return;

    setErrorMsg(null);
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    const modelPlaceholderId = `m-${Date.now() + 1}`;
    const selectedModelName =
      modelMode === 'fast' ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';

    const nextHistory = [...messages, userMsg];
    onChangeMessages([
      ...nextHistory,
      {
        id: modelPlaceholderId,
        role: 'model',
        text: '',
        modelName: selectedModelName,
      },
    ]);
    setInput('');
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({ role: m.role, text: m.text })),
          context: telemetryContext,
          mode: modelMode,
        }),
        signal: controller.signal,
      });

      const contentType = resp.headers.get('content-type') || '';
      if (!resp.ok || !contentType.includes('text/event-stream')) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(
          (errJson as { error?: string }).error || `Request failed (${resp.status})`
        );
      }

      const reader = resp.body?.getReader();
      if (!reader) {
        throw new Error('Streaming response body is unavailable.');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const evt of events) {
          const dataLine = evt
            .split('\n')
            .find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(6)) as {
            delta?: string;
            done?: boolean;
            error?: string;
            model?: string;
          };
          if (payload.error) {
            throw new Error(payload.error);
          }
          if (payload.delta) {
            accumulated += payload.delta;
            onChangeMessages((prev) =>
              prev.map((m) =>
                m.id === modelPlaceholderId ? { ...m, text: accumulated } : m
              )
            );
          }
        }
      }

      if (!accumulated.trim()) {
        onChangeMessages((prev) =>
          prev.map((m) =>
            m.id === modelPlaceholderId
              ? { ...m, text: 'No response generated. Please try rephrasing your question.' }
              : m
          )
        );
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        return;
      }
      const msg = err instanceof Error ? err.message : 'Unable to reach Trend Detective AI.';
      setErrorMsg(msg);
      onChangeMessages((prev) =>
        prev.filter((m) => m.id !== modelPlaceholderId || m.text.trim().length > 0)
      );
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  // Auto-trigger pending contextual prompt passed from other tabs
  useEffect(() => {
    if (pendingPrompt && !isStreaming) {
      void sendMessage(pendingPrompt);
      onClearPendingPrompt?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  const stopStreaming = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const quickPrompts = useMemo(() => {
    const list: string[] = [
      'Answer the 4 Trend Detective questions for this view',
    ];
    if (effectivePoles.poleA && effectivePoles.poleB) {
      list.push(`Why do Pole A and Pole B trend oppositely under ${tele.shortLabel}?`);
    }
    if (dataMode !== 'historical') {
      list.push(`Compare Historical (2005–2024) vs. ${modeMeta.shortLabel} slopes`);
    } else {
      list.push('How should I interpret this Mann-Kendall Z-score and p-value?');
    }
    if (probedInfo && !probedInfo.domainMasked) {
      list.push(`Analyze my probed point at ${formatCoord(probedInfo.lat, probedInfo.lon)}`);
    }
    return list;
  }, [effectivePoles, tele.shortLabel, dataMode, modeMeta.shortLabel, probedInfo]);

  return (
    <div className="flex flex-col h-full min-h-[420px]">
      {/* Assistant Role & Model Mode Header */}
      <div className="pb-2.5 border-b border-slate-200 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Bot className="w-4 h-4 text-[#0B3D91] shrink-0" />
            <span className="text-xs font-semibold text-slate-900 truncate">
              NASA Trend Detective Scientist
            </span>
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                stopStreaming();
                setErrorMsg(null);
                onChangeMessages([]);
              }}
              className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 rounded border border-slate-200 flex items-center gap-1 cursor-pointer shrink-0"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>

        {/* Model Selector: Standard (gemini-4-hydrogen) vs Fast Brief (gemini-3.1-flash-lite) */}
        <div
          role="group"
          aria-label="Gemini model mode"
          className="grid grid-cols-2 p-0.5 bg-slate-100 rounded-md border border-slate-200"
        >
          <button
            type="button"
            onClick={() => setModelMode('general')}
            className={`px-2 py-1 text-[11px] font-medium rounded flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
              modelMode === 'general'
                ? 'bg-white text-[#0B3D91] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            Standard · 4-Hydrogen
          </button>
          <button
            type="button"
            onClick={() => setModelMode('fast')}
            className={`px-2 py-1 text-[11px] font-medium rounded flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
              modelMode === 'fast'
                ? 'bg-white text-[#0B3D91] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Zap className="w-3 h-3" />
            Fast Brief · 3.1-Lite
          </button>
        </div>

        {/* Grounded Telemetry Strip */}
        <div className="px-2.5 py-1.5 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-600 font-mono truncate">
          Synced: {dataset.shortName} · {MONTH_ABBR[month - 1]} {year} · {modeMeta.shortLabel}
        </div>
      </div>

      {/* Scrollable Multi-Turn Conversation Thread */}
      <div className="flex-1 min-h-0 overflow-y-auto py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/80 text-xs text-slate-600 leading-relaxed space-y-1.5">
              <div className="font-semibold text-slate-900">
                Multi-Turn Earth System Analysis Assistant
              </div>
              <p>
                Ask questions about the active satellite mission or model projection, opposing
                teleconnection poles, Mann-Kendall significance, or how to verify trends in NASA
                Giovanni, AppEEARS, SWOT, CSA RADARSAT RCM, and KNMI Climate Explorer.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Suggested Questions
              </div>
              <div className="space-y-1.5">
                {quickPrompts.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void sendMessage(q)}
                    className="w-full text-left px-2.5 py-2 rounded-md border border-slate-200 bg-white hover:border-[#0B3D91] hover:bg-blue-50/40 text-xs text-slate-700 transition-colors cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col gap-1 ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 px-0.5">
                {msg.role === 'user' ? (
                  <>
                    <span>Investigator</span>
                    <User className="w-3 h-3 text-slate-500" />
                  </>
                ) : (
                  <>
                    <Bot className="w-3 h-3 text-[#0B3D91]" />
                    <span className="text-[#0B3D91]">Trend Detective AI</span>
                    {msg.modelName && (
                      <span className="font-mono font-normal text-slate-400">
                        ({msg.modelName})
                      </span>
                    )}
                  </>
                )}
              </div>

              <div
                className={`max-w-[95%] rounded-lg px-3 py-2.5 border ${
                  msg.role === 'user'
                    ? 'bg-[#0B3D91] border-[#0B3D91] text-white text-xs leading-relaxed'
                    : 'bg-slate-50/90 border-slate-200 text-slate-800'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                ) : msg.text ? (
                  <FormattedMessage text={msg.text} />
                ) : (
                  <span className="text-xs text-slate-500 font-mono">
                    Analyzing telemetry...
                  </span>
                )}
              </div>
            </div>
          ))
        )}

        {errorMsg && (
          <div className="p-2.5 rounded-md border border-red-200 bg-red-50 text-xs text-red-800">
            {errorMsg}
          </div>
        )}

        <div ref={threadEndRef} />
      </div>

      {/* Follow-Up Prompt Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage(input);
        }}
        className="pt-2.5 border-t border-slate-200 space-y-2 shrink-0"
      >
        {messages.length > 0 && !isStreaming && (
          <div className="flex flex-wrap gap-1">
            {quickPrompts.slice(0, 2).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void sendMessage(q)}
                className="px-2 py-0.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[10px] text-slate-600 truncate max-w-full cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1.5">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendMessage(input);
              }
            }}
            placeholder="Ask about trends, opposing poles, significance, or RCP pathways..."
            aria-label="Ask Trend Detective AI"
            className="flex-1 resize-none rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0B3D91]"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={stopStreaming}
              aria-label="Stop generating response"
              className="px-3 py-2 rounded-md bg-slate-800 text-white hover:bg-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0 h-[52px]"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send message"
              className="px-3 py-2 rounded-md bg-[#0B3D91] text-white hover:bg-[#092E6E] disabled:opacity-45 disabled:cursor-not-allowed text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0 h-[52px]"
            >
              <Send className="w-3.5 h-3.5" />
              Ask
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
