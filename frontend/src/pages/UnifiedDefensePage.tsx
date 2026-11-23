import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  History,
  Loader2,
  Plug,
  Settings,
  Upload,
} from "lucide-react";
import { AnalyticsDrawer } from "../components/unified/AnalyticsDrawer";
import { HistoryDrawer } from "../components/unified/HistoryDrawer";
import { SettingsModal } from "../components/unified/SettingsModal";
import { TestParamsModal } from "../components/unified/TestParamsModal";
import { AnimatedFlowBackground } from "../components/v4/AnimatedFlowBackground";
import { VigiliaPixelLogo } from "../components/v4/VigiliaPixelLogo";
import { StepComparisonView } from "../components/v5/StepComparisonView";
import { StepConfigureView } from "../components/v5/StepConfigureView";
import { StepDiagnosisView } from "../components/v5/StepDiagnosisView";
import { type ActiveStepId, TopNavbar } from "../components/v5/TopNavbar";
import { useDefenseWorkflow } from "../hooks/useDefenseWorkflow";
import type { Language } from "../i18n/translations";

export const UnifiedDefensePage: React.FC = () => {
  const wf = useDefenseWorkflow();
  const { t, lang, setLang } = wf;

  const [viewStep, setViewStep] = useState<ActiveStepId>(1);

  const maxUnlockedStep: ActiveStepId = wf.hasComparisonBlock
    ? 3
    : wf.improvementPhase !== "BASELINE_RESULT"
      ? 2
      : 1;

  // Automatically advance viewStep when workflow phase progresses
  useEffect(() => {
    if (wf.hasComparisonBlock && wf.improvementPhase === "COMPARISON_AVAILABLE") {
      setViewStep(3);
    } else if (
      wf.improvementPhase === "CANDIDATE_READY" ||
      wf.improvementPhase === "VERIFICATION"
    ) {
      setViewStep(2);
    } else if (
      wf.improvementPhase === "BASELINE_RESULT" ||
      wf.improvementPhase === "IMPROVEMENT_REQUESTED"
    ) {
      setViewStep(1);
    }
  }, [wf.improvementPhase, wf.hasComparisonBlock]);

  const formatLocaleNumber = (val: number) =>
    new Intl.NumberFormat(lang === "en" ? "en-US" : "ru-RU").format(val);

  const renderHeroBlock01 = () => {
    const testingSourceTag =
      wf.selectedEngine?.adapter_type === "external_api"
        ? "External API"
        : wf.selectedEngine?.adapter_type === "imported"
          ? "Imported"
          : "Internal";

    const handleOpenImportFlow = () => {
      wf.setErrorState(null);
      wf.setSelectedEngineCode("imported_predictions");
      wf.setParamsOpen(true);
    };

    const handleOpenApiFlow = () => {
      wf.setErrorState(null);
      if (wf.selectedEngineCode === "imported_predictions") {
        wf.setSelectedEngineCode(
          wf.externalBEngine?.online ? "external_b" : "internal_vigilia"
        );
      }
      wf.setParamsOpen(true);
    };

    return (
      <div className="relative min-h-screen flex items-center justify-center px-4 py-10">
        <div className="fixed top-5 right-5 z-20 flex items-center gap-2">
          <div className="bg-[#121816]/80 backdrop-blur-md flex items-center gap-1 p-1 rounded-full">
            {(["ru", "kk", "en"] as Language[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`px-3 py-1 text-xs font-bold uppercase rounded-full transition-all ${
                  lang === code
                    ? "bg-[#16A34A] text-white"
                    : "text-[#94A3B8] hover:text-[#F1F5F9]"
                }`}
              >
                {code === "kk" ? "KZ" : code.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => wf.setHistoryOpen(true)}
            className="btn-subtle rounded-xl py-2 px-4 text-sm font-medium"
            title={t.topBar.history}
          >
            <History className="h-4 w-4 text-[#22C55E]" />
            <span className="hidden sm:inline">{t.topBar.history}</span>
            {wf.experiments.length > 0 && (
              <span className="font-mono text-xs font-semibold text-[#22C55E] bg-[#16A34A]/15 px-1.5 py-0.5 rounded-full">
                {wf.experiments.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => wf.setSettingsOpen(true)}
            className="btn-subtle rounded-xl py-2 px-3 text-sm font-medium"
            aria-label={t.topBar.settings}
            title={t.topBar.settings}
          >
            <Settings className="h-4 w-4 text-[#94A3B8]" />
          </button>
        </div>

        <div className="relative z-10 w-full max-w-[600px] text-center space-y-8 focus-enter">
          <div className="flex justify-center">
            <VigiliaPixelLogo variant="hero" />
          </div>

          <p className="text-base sm:text-lg font-medium text-[#94A3B8] max-w-md mx-auto leading-relaxed">
            {t.v4.heroTagline}
          </p>

          {wf.errorState && wf.errorState.returnStage === "idle" && (
            <div className="v4-surface px-4 py-3 text-sm text-[#EF4444] text-left flex items-center justify-between gap-3 max-w-lg mx-auto">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{wf.errorState.message}</span>
              </div>
              <button
                type="button"
                onClick={wf.handleStartCheck}
                className="font-semibold underline shrink-0"
              >
                {t.focus.retryBtn}
              </button>
            </div>
          )}

          {wf.stage === "testing" ? (
            <div className="v4-surface p-6 text-left space-y-4 max-w-lg mx-auto">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Loader2 className="h-4 w-4 animate-spin text-[#22C55E]" />
                  <span className="text-[15px] font-semibold text-[#F1F5F9]">
                    {t.focus.testingTitle}
                  </span>
                </div>
                <span className="font-mono text-sm text-[#22C55E] font-semibold tabular-nums">
                  {(wf.testingElapsedMs / 1000).toFixed(1)}s
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-xs text-[#94A3B8]">{t.v33.metaEngine}</div>
                  <div className="font-semibold text-[#F1F5F9] mt-0.5">
                    {wf.selectedEngine?.name || t.ext.internalLabel}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#94A3B8]">{t.v33.liveSourceLabel}</div>
                  <div className="font-mono text-[#CBD5E1] mt-0.5">
                    {testingSourceTag}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#94A3B8]">{t.v33.liveTotalTxLabel}</div>
                  <div className="tabular-nums font-semibold text-[#F1F5F9] mt-0.5">
                    {formatLocaleNumber(wf.effectiveTxCount)}
                  </div>
                </div>
              </div>

              <div className="v4-surface-inset px-3.5 py-2.5 text-sm text-[#CBD5E1] flex flex-wrap items-center justify-between gap-2">
                <strong className="text-[#F1F5F9]">
                  {wf.testingPhase === "preparing"
                    ? t.v33.stagePreparing
                    : wf.testingPhase === "running"
                      ? t.v33.stageSentWait
                      : t.v33.stageComputing}
                </strong>
                {wf.testingDatasetLabel && (
                  <span className="text-xs text-[#94A3B8] truncate">
                    {wf.testingDatasetLabel}
                  </span>
                )}
              </div>
              <div className="v4-shimmer-track">
                <div className="v4-shimmer-bar" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-1">
              <button
                type="button"
                onClick={handleOpenImportFlow}
                disabled={wf.configsLoading}
                className="btn-subtle rounded-xl w-full sm:w-52 px-7 py-3.5 text-base font-medium inline-flex items-center justify-center gap-2.5"
              >
                <Upload className="h-4 w-4 text-[#94A3B8]" />
                <span>{t.v4.btnImport}</span>
              </button>

              <button
                type="button"
                onClick={handleOpenApiFlow}
                disabled={wf.configsLoading}
                className="btn-primary rounded-full w-full sm:w-56 px-8 py-3.5 text-base font-semibold inline-flex items-center justify-center gap-2.5"
              >
                <Plug className="h-4 w-4" />
                <span>{t.v4.btnViaApi}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderUnifiedWorkspace = () => {
    if (wf.isHydratingSavedWorkspace || !wf.activeExp) {
      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="text-center space-y-3">
            <Loader2 className="h-7 w-7 text-[#22C55E] animate-spin mx-auto" />
            <p className="text-sm text-[#94A3B8]">{t.result.loadingState}</p>
          </div>
        </div>
      );
    }

    const activeExp = wf.activeExp;
    const modeBadge =
      activeExp.adapter_type === "external_api"
        ? "External API"
        : activeExp.adapter_type === "imported"
          ? t.ext.adapterImported
          : `${t.ext.internalLabel} (Internal)`;

    return (
      <div className="min-h-screen">
        <TopNavbar
          activeStep={viewStep}
          maxUnlockedStep={maxUnlockedStep}
          onSelectStep={setViewStep}
          modeBadge={modeBadge}
          historyCount={wf.experiments.length}
          onOpenHistory={() => wf.setHistoryOpen(true)}
          onOpenAnalytics={() => wf.handleOpenAnalytics("overview")}
          onOpenSettings={() => wf.setSettingsOpen(true)}
          onNewCheck={wf.handleResetToIdle}
        />

        <div className="max-w-[1440px] mx-auto px-6 py-6 sm:py-8 space-y-6">
          {wf.errorState && wf.errorState.returnStage === "results" && (
            <div className="v4-surface px-4 py-3 text-sm text-[#EF4444] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{wf.errorState.message}</span>
              </div>
              <button
                type="button"
                onClick={() => wf.setErrorState(null)}
                className="underline font-semibold shrink-0"
              >
                ×
              </button>
            </div>
          )}

          {viewStep === 1 && (
            <div className="max-w-5xl mx-auto">
              <StepDiagnosisView
                experiment={activeExp}
                intelligence={wf.intelligence}
                weaknesses={wf.topProblems}
                analyzing={wf.analyzePending || wf.improvementPhase === "IMPROVEMENT_REQUESTED"}
                hasCandidateReady={maxUnlockedStep >= 2}
                onStartImprovement={wf.handleStartImprovement}
                onCancelImprovement={wf.handleCancelImprovement}
                onGoToStep2={() => setViewStep(2)}
                onInspectTransaction={(code) => wf.handleOpenInspector(code, activeExp.id)}
                onOpenAnalytics={wf.handleOpenAnalytics}
              />
            </div>
          )}

          {viewStep === 2 && (
            <div className="max-w-5xl mx-auto">
              <StepConfigureView
                experiment={activeExp}
                evolutionRun={wf.activeEvolution}
                externalEvolution={wf.activeExternalEvolution}
                analyzing={wf.analyzePending}
                validating={wf.validatePending || wf.improvementPhase === "VERIFICATION"}
                selectedCandidateKey={wf.selectedCandidateKey}
                onSelectCandidateKey={wf.setSelectedCandidateKey}
                onValidate={wf.triggerValidate}
                onAnalyzeManual={wf.handleStartImprovement}
                onCancelImprovement={wf.handleCancelImprovement}
                retestFormat={wf.retestFormat}
                onChangeRetestFormat={wf.setRetestFormat}
                retestVersionLabel={wf.retestVersionLabel}
                onChangeRetestVersionLabel={wf.setRetestVersionLabel}
                retestContent={wf.retestContent}
                onChangeRetestContent={wf.setRetestContent}
                onRetestBlackBox={wf.triggerRetest}
                retesting={wf.retestPending}
              />
            </div>
          )}

          {viewStep === 3 && wf.hasComparisonBlock && (
            <StepComparisonView
              experiment={activeExp}
              evolutionRun={wf.activeEvolution}
              externalEvolution={wf.activeExternalEvolution}
              diffData={wf.activeDiffData}
              intelligence={wf.intelligence}
              onOpenAnalytics={wf.handleOpenAnalytics}
              onBackToStart={wf.handleResetToIdle}
            />
          )}
        </div>
      </div>
    );
  };

  const inWorkspace = wf.stage === "results" || wf.stage === "comparison";

  return (
    <div className="relative min-h-screen bg-[#0A0E0D] text-[#F1F5F9] overflow-x-hidden">
      <AnimatedFlowBackground
        compact={inWorkspace}
        paused={wf.analyticsOpen}
        enabled={wf.bgAnimationEnabled}
      />

      <main className="relative z-10">
        {wf.stage === "idle" || wf.stage === "testing"
          ? renderHeroBlock01()
          : renderUnifiedWorkspace()}
      </main>

      <TestParamsModal
        open={wf.paramsOpen}
        onClose={() => wf.setParamsOpen(false)}
        onRunCheck={wf.handleStartCheck}
        engines={wf.engines}
        selectedEngineCode={wf.selectedEngineCode}
        onChangeEngineCode={wf.setSelectedEngineCode}
        externalProfile={wf.externalProfile}
        onChangeExternalProfile={wf.setExternalProfile}
        importFormat={wf.importFormat}
        onChangeImportFormat={wf.setImportFormat}
        importContent={wf.importContent}
        onChangeImportContent={wf.setImportContent}
        importVersionLabel={wf.importVersionLabel}
        onChangeImportVersionLabel={wf.setImportVersionLabel}
        configs={wf.configs}
        datasets={wf.datasets}
        selectedDefenseId={wf.selectedDefenseId}
        onChangeDefenseId={wf.setSelectedDefenseId}
        selectedDatasetId={wf.selectedDatasetId}
        onChangeDatasetId={wf.setSelectedDatasetId}
        txCount={wf.txCount}
        onChangeTxCount={wf.setTxCount}
        seed={wf.seed}
        onChangeSeed={wf.setSeed}
        splitName={wf.splitName}
        onChangeSplitName={wf.setSplitName}
      />

      <AnalyticsDrawer
        open={wf.analyticsOpen}
        initialTab={wf.analyticsTab}
        initialTxCode={wf.analyticsTxCode}
        inspectorExperimentId={wf.analyticsInspectorExpId}
        onClose={() => wf.setAnalyticsOpen(false)}
        experiment={wf.activeExp}
        intelligence={wf.intelligence}
        activeEvolution={wf.activeEvolution}
        activeExternalEvolution={wf.activeExternalEvolution}
        onEvolutionUpdated={wf.handleEvolutionUpdated}
        defenseConfig={wf.activeExpDefenseObj}
        engines={wf.engines}
        baselineConfigId={wf.baselineCfgForStability}
        candidateConfigId={wf.candidateCfgForStability}
        activeBenchmark={wf.matchingBenchmark}
        onBenchmarkCompleted={wf.setActiveBenchmark}
      />

      <HistoryDrawer
        open={wf.historyOpen}
        onClose={() => wf.setHistoryOpen(false)}
        experiments={wf.experiments}
        benchmarks={wf.benchmarks}
        activeExperimentId={wf.selectedExperimentId}
        onSelectExperiment={wf.handleSelectHistoryExperiment}
      />

      <SettingsModal
        open={wf.settingsOpen}
        onClose={() => wf.setSettingsOpen(false)}
        onDemoReset={wf.handleDemoReset}
      />
    </div>
  );
};
