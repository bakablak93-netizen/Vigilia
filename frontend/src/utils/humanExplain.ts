import type { Language } from "../i18n/translations";
import type {
  BenchmarkSeedResult,
  ExperimentSummary,
  MetricsSummary,
  RiskDistributionBucket,
  ScenarioComparisonItem,
  ScenarioMetric,
} from "../types/api";

export interface VigiliaConclusionData {
  tone: "good" | "warn" | "danger" | "neutral";
  headlineBadge: string;
  whatChecked: string;
  whatFound: string;
  whatMeans: string;
  whatRecommended: string;
  isIncomplete: boolean;
  hasZeroRisks: boolean;
}

export interface ChartExplainContent {
  shortSummary: string;
  attentionPoint: string;
  whatShows: string;
  detailedMeaning: string;
}

export interface WeaknessPlainStory {
  whatHappened: string;
  whyProblem: string;
  whatToCheck: string;
}

export interface ComparisonPlainStory {
  headline: string;
  shouldAdopt: string;
  tone: "good" | "warn" | "danger";
}

function fmtNum(n: number, lang: Language): string {
  return new Intl.NumberFormat(lang === "en" ? "en-US" : "ru-RU").format(n);
}

function fmtPct(v: number, lang: Language, d = 1): string {
  const s = (v * 100).toFixed(d);
  return `${lang === "en" ? s : s.replace(".", ",")}%`;
}

/**
 * 1. Deterministic "Заключение VIGILIA" generated purely from API experiment metrics.
 */
export function buildVigiliaConclusion(
  experiment: ExperimentSummary,
  scenarioLabel: (key: string) => string,
  lang: Language
): VigiliaConclusionData {
  const m = experiment.metrics_json;
  const engName =
    experiment.engine_name ||
    (lang === "en"
      ? "Internal Test Defense"
      : lang === "kk"
        ? "Ішкі тест қорғанысы"
        : "встроенную тестовую защиту");
  const totalTx = m.total_transactions;
  const actualRisks = m.actual_risk_events;
  const tp = m.true_positives;
  const fn = m.false_negatives;
  const fp = m.false_positives;
  const missing = Number(experiment.completeness_json?.missing_count || 0);
  const isBlackBox = experiment.diagnostic_mode === "black_box";

  const worstScenarios = (experiment.scenario_metrics_json || [])
    .filter((s) => s.actual_risk_events > 0 && s.false_negatives > 0)
    .sort((a, b) => b.false_negatives - a.false_negatives)
    .slice(0, 2)
    .map((s) => scenarioLabel(s.scenario_type));

  const worstList = worstScenarios.join(", ");

  // Edge case: 0 risky transactions in dataset/split
  if (actualRisks === 0) {
    if (lang === "en") {
      return {
        tone: fp > 0 ? "warn" : "neutral",
        headlineBadge: fp > 0 ? "False blocks only" : "No risky cases in set",
        whatChecked: `We tested «${engName}» on ${fmtNum(totalTx, lang)} synthetic test operations.`,
        whatFound: `There were 0 risky test operations in this split. Legitimate operations falsely flagged: ${fp}.`,
        whatMeans: `Detection completeness (Recall) cannot be evaluated without risky test cases.`,
        whatRecommended: `Select a dataset or split that includes risky test scenarios to evaluate threat detection.`,
        isIncomplete: missing > 0,
        hasZeroRisks: true,
      };
    }
    if (lang === "kk") {
      return {
        tone: fp > 0 ? "warn" : "neutral",
        headlineBadge: fp > 0 ? "Жалған бұғаттаулар бар" : "Қауіпті жағдайлар жоқ",
        whatChecked: `Біз «${engName}» жүйесін ${fmtNum(totalTx, lang)} тест операциясында тексердік.`,
        whatFound: `Бұл бөлікте қауіпті тест операциялары жоқ (0). Қате бұғатталған заңды операциялар: ${fp}.`,
        whatMeans: `Қауіпті мысалдарсыз анықтау толықтығын (Recall) бағалау мүмкін емес.`,
        whatRecommended: `Қорғанысты бағалау үшін қауіпті сценарийлері бар жинақты таңдаңыз.`,
        isIncomplete: missing > 0,
        hasZeroRisks: true,
      };
    }
    return {
      tone: fp > 0 ? "warn" : "neutral",
      headlineBadge: fp > 0 ? "Есть ложные блокировки" : "Нет рискованных операций",
      whatChecked: `Мы проверили антифрод-систему «${engName}» на ${fmtNum(totalTx, lang)} тестовых операциях.`,
      whatFound: `В выбранной выборке не оказалось рискованных операций (0). Ошибочно помечено обычных операций: ${fp}.`,
      whatMeans: `Без рискованных тестовых кейсов невозможно измерить, насколько хорошо защита их обнаруживает.`,
      whatRecommended: `Выберите набор или срез с рискованными сценариями, чтобы оценить качество обнаружения.`,
      isIncomplete: missing > 0,
      hasZeroRisks: true,
    };
  }

  const recall = tp / actualRisks;
  const fpr = m.false_positive_rate;

  let tone: VigiliaConclusionData["tone"] = "good";
  if (missing > 0 || recall < 0.5 || fpr > 0.03) {
    tone = "danger";
  } else if (fn > 0 || fp > 0) {
    tone = "warn";
  }

  if (lang === "en") {
    const badge =
      tone === "good"
        ? "Clean on test set"
        : tone === "danger"
          ? "High miss / risk rate"
          : "Weaknesses detected";
    const whatChecked = `We tested «${engName}» on ${fmtNum(totalTx, lang)} synthetic test operations.`;
    const fpClause =
      fp === 0
        ? "No legitimate operations were falsely flagged."
        : `Also, ${fp} legitimate ${fp === 1 ? "operation was" : "operations were"} falsely flagged as risky.`;
    const missingClause =
      missing > 0 ? ` (${missing} operations did not receive a response from the API.)` : "";
    const whatFound = `Out of ${actualRisks} risky test operations, the defense detected ${tp} (${fmtPct(recall, lang)}) and missed ${fn}. ${fpClause}${missingClause}`;

    let whatMeans: string;
    if (fn === 0 && fp === 0) {
      whatMeans = `On this synthetic test set, the defense caught all risky test cases with zero false blocks. This confirms behavior on this sample only.`;
    } else if (recall < 0.5) {
      whatMeans = `On this test set, the defense frequently misses risky test operations.${worstList ? ` The weakest scenarios are: ${worstList}.` : ""}`;
    } else if (fn > 0) {
      whatMeans = `The defense catches most threats but still leaves blind spots.${worstList ? ` Missed cases concentrate in: ${worstList}.` : ""}${fp > 0 ? ` False blocks (${fmtPct(fpr, lang, 2)}) may also affect legitimate clients.` : ""}`;
    } else {
      whatMeans = `All risky test cases were detected, but ${fp} legitimate operations were blocked by mistake (FPR ${fmtPct(fpr, lang, 2)}).`;
    }

    const whatRecommended = isBlackBox
      ? `Vendor rules stay hidden (Black-Box). Tune only the external risk_score cutoff & Allow / Review / Block routing, and prepare recommendations for the vendor team.`
      : fn > 0 || fp > 0
        ? `Analyze internal rule parameters on validation and verify the candidate configuration on the held-out evaluation split.`
        : `You can inspect scenario charts or run a multi-seed stability benchmark to verify consistency across different datasets.`;

    return {
      tone,
      headlineBadge: badge,
      whatChecked,
      whatFound,
      whatMeans,
      whatRecommended,
      isIncomplete: missing > 0,
      hasZeroRisks: false,
    };
  }

  if (lang === "kk") {
    const badge =
      tone === "good"
        ? "Тест жинағында қате жоқ"
        : tone === "danger"
          ? "Өткізу деңгейі жоғары"
          : "Әлсіз тұстар анықталды";
    const whatChecked = `Біз «${engName}» антифрод-жүйесін ${fmtNum(totalTx, lang)} тест операциясында тексердік.`;
    const fpClause =
      fp === 0
        ? "Заңды операциялар қате бұғатталмады."
        : `Сонымен қатар ${fp} заңды операция қате түрде қауіпті деп белгіленді.`;
    const missingClause =
      missing > 0 ? ` (${missing} операция бойынша сыртқы API жауап бермеді.)` : "";
    const whatFound = `${actualRisks} қауіпті тест операциясының ${tp}-і анықталды (${fmtPct(recall, lang)}), ал ${fn}-і өткізіліп алынды. ${fpClause}${missingClause}`;

    let whatMeans: string;
    if (fn === 0 && fp === 0) {
      whatMeans = `Бұл синтетикалық жинақта барлық қауіпті операциялар жалған бұғаттаусыз анықталды.`;
    } else if (recall < 0.5) {
      whatMeans = `Осы тест жинағында қорғаныс қауіпті операцияларды жиі өткізіп алады.${worstList ? ` Ең әлсіз сценарийлер: ${worstList}.` : ""}`;
    } else if (fn > 0) {
      whatMeans = `Қорғаныс қауіптердің көбін ұстайды, бірақ бос орындар бар.${worstList ? ` Өткізілген жағдайлар көбіне мына сценарийлерде: ${worstList}.` : ""}`;
    } else {
      whatMeans = `Қауіпті операциялар түгел табылды, бірақ ${fp} заңды операция қате бұғатталды (FPR ${fmtPct(fpr, lang, 2)}).`;
    }

    const whatRecommended = isBlackBox
      ? `Ішкі ережелер жабық (Black-Box). Тек сыртқы risk_score шегі мен Allow / Review / Block бағыттауын баптауға және вендор тобына ұсыныстар дайындауға болады.`
      : fn > 0 || fp > 0
        ? `Ішкі ережелердің параметрлерін талдап, үміткер нұсқаны тәуелсіз жинақта тексеру ұсынылады.`
        : `Нәтиженің тұрақтылығын тексеру үшін сценарий графиктерін немесе бірнеше прогонды (Benchmark) қарауға болады.`;

    return {
      tone,
      headlineBadge: badge,
      whatChecked,
      whatFound,
      whatMeans,
      whatRecommended,
      isIncomplete: missing > 0,
      hasZeroRisks: false,
    };
  }

  // Russian (default)
  const badge =
    tone === "good"
      ? "На тесте проблем не выявлено"
      : tone === "danger"
        ? "Высокий уровень пропусков"
        : "Обнаружены слабые места";
  const whatChecked = `Мы проверили антифрод-систему «${engName}» на ${fmtNum(totalTx, lang)} тестовых операциях.`;
  const fpMod10 = fp % 10;
  const fpMod100 = fp % 100;
  const fpClause =
    fp === 0
      ? "Ошибочных блокировок обычных операций не было."
      : fpMod10 === 1 && fpMod100 !== 11
        ? `Также ${fp} обычная операция была ошибочно помечена как рискованная.`
        : fpMod10 >= 2 && fpMod10 <= 4 && (fpMod100 < 12 || fpMod100 > 14)
          ? `Также ${fp} обычные операции были ошибочно помечены как рискованные.`
          : `Также ${fp} обычных операций были ошибочно помечены как рискованные.`;
  const missingClause =
    missing > 0 ? ` (${missing} операций не получили ответ от внешнего API.)` : "";
  const whatFound = `Из ${actualRisks} рискованных тестовых операций защита обнаружила ${tp} (${fmtPct(recall, lang)}), а ${fn} пропустила. ${fpClause}${missingClause}`;

  let whatMeans: string;
  if (fn === 0 && fp === 0) {
    whatMeans = `На данном тестовом наборе все рискованные операции были обнаружены без ложных блокировок. Вывод относится только к этой выборке.`;
  } else if (recall < 0.5) {
    whatMeans = `На данном тестовом наборе защита часто пропускает рискованные операции.${worstList ? ` Наиболее проблемные сценарии: ${worstList}.` : ""}`;
  } else if (fn > 0) {
    whatMeans = `Защита находит значительную часть угроз, но оставляет заметные пробелы.${worstList ? ` Пропуски сосредоточены в сценариях: ${worstList}.` : ""}${fp > 0 ? ` При этом ложные срабатывания (FPR ${fmtPct(fpr, lang, 2)}) могут затрагивать обычных клиентов.` : ""}`;
  } else {
    whatMeans = `Все рискованные тестовые операции обнаружены, однако ${fp} обычных операций попали под ошибочную блокировку (FPR ${fmtPct(fpr, lang, 2)}).`;
  }

  const whatRecommended = isBlackBox
    ? `Внутренние правила скрыты (Black-Box): доступны настройка внешнего порога risk_score и маршрутизации Allow / Review / Block, а также рекомендации команде вендора.`
    : fn > 0 || fp > 0
      ? `Доступна настройка внутренних правил (White-Box): подберите параметры на validation и проверьте результат на контрольной выборке evaluation.`
      : `Можно проверить устойчивость результата на нескольких тестовых прогонах (Benchmark) или изучить детали по сценариям.`;

  return {
    tone,
    headlineBadge: badge,
    whatChecked,
    whatFound,
    whatMeans,
    whatRecommended,
    isIncomplete: missing > 0,
    hasZeroRisks: false,
  };
}

/**
 * 2. Chart explanations for all 6 charts (short 1-line summary + expandable full meaning).
 */
export function buildDetectionChartExplain(
  tp: number,
  fn: number,
  fp: number,
  tn: number,
  lang: Language
): ChartExplainContent {
  const actual = tp + fn;
  const legit = fp + tn;
  if (actual === 0) {
    return lang === "en"
      ? {
          shortSummary: "No risky test operations were present in this split.",
          attentionPoint: `False blocks on legitimate operations: ${fp} of ${legit}.`,
          whatShows: "Green shows caught risky operations, yellow shows missed ones; false blocks are shown separately.",
          detailedMeaning: "Because there are 0 risky cases in this dataset slice, only false positives on legitimate transactions can be observed.",
        }
      : lang === "kk"
        ? {
            shortSummary: "Бұл бөлікте қауіпті тест операциялары болмады.",
            attentionPoint: `Заңды операциялардағы жалған бұғаттау: ${legit} ішінен ${fp}.`,
            whatShows: "Жасыл бөлік — табылған қауіпті операциялар, сары — өткізілгендер; жалған бұғаттаулар бөлек көрсетіледі.",
            detailedMeaning: "Қауіпті мысалдар болмағандықтан, тек заңды операциялардағы қате бұғаттауларды көруге болады.",
          }
        : {
            shortSummary: "В этой выборке нет рискованных тестовых операций.",
            attentionPoint: `Ложных блокировок обычных операций: ${fp} из ${legit}.`,
            whatShows: "Зелёная часть показывает обнаруженные рискованные операции, жёлтая — пропущенные; ложные блокировки вынесены отдельно.",
            detailedMeaning: "Поскольку рискованных кейсов в выборке нет, можно оценить только отсутствие ложных срабатываний на обычных операциях.",
          };
  }

  const pct = (tp / actual) * 100;
  if (lang === "en") {
    return {
      shortSummary: `Detected ${tp} of ${actual} risky test operations (${pct.toFixed(1)}%), missed ${fn}.`,
      attentionPoint:
        fn > 0
          ? `${fn} risky test operations were missed (yellow bar).`
          : fp > 0
            ? `Zero misses, but ${fp} legitimate operations were falsely flagged.`
            : "All risky test operations were detected with 0 false blocks.",
      whatShows: "Green shows detected risky operations, yellow shows missed ones. The larger the yellow portion, the more threats slip through.",
      detailedMeaning: `Out of ${actual} risky test cases, ${tp} were flagged and ${fn} passed undetected. Separately, among ${legit} legitimate operations, ${fp} were falsely flagged.`,
    };
  }
  if (lang === "kk") {
    return {
      shortSummary: `${actual} қауіпті операцияның ${tp}-і табылды (${pct.toFixed(1)}%), ${fn}-і өткізілді.`,
      attentionPoint:
        fn > 0
          ? `${fn} қауіпті тест операциясы өткізіліп алынды (сары бөлік).`
          : fp > 0
            ? `Өткізу жоқ, бірақ ${fp} заңды операция қате бұғатталды.`
            : "Барлық қауіпті операциялар жалған бұғаттаусыз табылды.",
      whatShows: "Жасыл бөлік анықталған қауіпті операцияларды, сары бөлік өткізілгендерді көрсетеді. Сары бөлік үлкен болған сайын көбірек қауіп байқалмай қалады.",
      detailedMeaning: `${actual} қауіпті операцияның ${tp}-і бұғатталды, ${fn}-і өтіп кетті. Бөлек ${legit} заңды операцияның ${fp}-і қате белгіленді.`,
    };
  }
  return {
    shortSummary: `Обнаружено ${tp} из ${actual} рискованных операций (${pct.toFixed(1).replace(".", ",")}%), пропущено ${fn}.`,
    attentionPoint:
      fn > 0
        ? `Жёлтая часть показывает ${fn} пропущенных рискованных тестовых операций.`
        : fp > 0
          ? `Пропусков нет, но ошибочно помечено ${fp} обычных операций.`
          : "Все рискованные тестовые операции обнаружены без ложных блокировок.",
    whatShows: "Зелёная часть показывает обнаруженные рискованные операции, жёлтая — пропущенные. Чем больше жёлтая часть, тем больше угроз защита не замечает.",
    detailedMeaning: `Из ${actual} рискованных операций система выявила ${tp} и пропустила ${fn}. Отдельно среди ${legit} обычных операций ошибочно помечено ${fp}.`,
  };
}

export function buildScenarioChartExplain(
  scenarios: ScenarioMetric[],
  scenarioLabel: (key: string) => string,
  lang: Language
): ChartExplainContent {
  const risky = scenarios.filter((s) => s.actual_risk_events > 0);
  const worst = [...risky].sort((a, b) => a.recall - b.recall || b.false_negatives - a.false_negatives)[0];
  const best = [...risky].sort((a, b) => b.recall - a.recall)[0];

  if (!worst) {
    return lang === "en"
      ? {
          shortSummary: "No risky scenarios with risk events in this slice.",
          attentionPoint: "Add risky scenarios to compare detection across attack types.",
          whatShows: "Shows which types of risky operations the system catches well and which it misses.",
          detailedMeaning: "None of the scenarios in this slice contained risky ground-truth events.",
        }
      : lang === "kk"
        ? {
            shortSummary: "Бұл жинақта қауіпті оқиғалары бар сценарийлер жоқ.",
            attentionPoint: "Салыстыру үшін қауіпті сценарийлері бар деректерді таңдаңыз.",
            whatShows: "Жүйе қай қауіп түрлерін жақсы танитынын, ал қайсысын жиі өткізетінін көрсетеді.",
            detailedMeaning: "Ағымдағы бөлікте қауіпті белгісі бар оқиғалар кездеспеді.",
          }
        : {
            shortSummary: "В выбранной выборке нет сценариев с рискованными событиями.",
            attentionPoint: "Для сравнения по сценариям нужен набор с рискованными операциями.",
            whatShows: "Здесь видно, какие виды рискованных операций система распознаёт лучше, а какие чаще пропускает.",
            detailedMeaning: "В текущем срезе нет сценариев с рискованными событиями.",
          };
  }

  const wName = scenarioLabel(worst.scenario_type);
  const bName = best ? scenarioLabel(best.scenario_type) : wName;

  if (lang === "en") {
    return {
      shortSummary: `Weakest scenario: «${wName}» (${fmtPct(worst.recall, lang)}, missed ${worst.false_negatives}/${worst.actual_risk_events}).`,
      attentionPoint:
        worst.false_negatives > 0
          ? `Focus tuning on «${wName}» first.`
          : `All scenarios reached 100% detection on this set.`,
      whatShows: "Shows which types of risky operations the system recognizes best and which it misses most often.",
      detailedMeaning: `Strongest detection was in «${bName}» (${fmtPct(best.recall, lang)}), while «${wName}» missed ${worst.false_negatives} of ${worst.actual_risk_events} risky test cases.`,
    };
  }
  if (lang === "kk") {
    return {
      shortSummary: `Ең әлсіз сценарий: «${wName}» (${fmtPct(worst.recall, lang)}, өткізілгені ${worst.false_negatives}/${worst.actual_risk_events}).`,
      attentionPoint:
        worst.false_negatives > 0
          ? `Алдымен «${wName}» сценарийіне назар аударыңыз.`
          : "Барлық сценарийлерде 100% анықтау көрсетілді.",
      whatShows: "Мұнда жүйенің қай қауіпті операция түрлерін жақсы танитыны, ал қайсысын жиі өткізетіні көрінеді.",
      detailedMeaning: `Ең жоғары нәтиже «${bName}» сценарийінде (${fmtPct(best.recall, lang)}), ал «${wName}» сценарийінде ${worst.actual_risk_events} қауіптің ${worst.false_negatives}-і өткізілді.`,
    };
  }
  return {
    shortSummary: `Самый проблемный сценарий: «${wName}» (${fmtPct(worst.recall, lang)}, пропущено ${worst.false_negatives} из ${worst.actual_risk_events}).`,
    attentionPoint:
      worst.false_negatives > 0
        ? `В первую очередь стоит проверить правила для «${wName}».`
        : "По всем сценариям с угрозами пропусков не зафиксировано.",
    whatShows: "Здесь видно, какие виды рискованных операций система распознаёт лучше, а какие чаще пропускает.",
    detailedMeaning: `Лучше всего сработал сценарий «${bName}» (${fmtPct(best.recall, lang)}), а хуже всего — «${wName}», где пропущено ${worst.false_negatives} из ${worst.actual_risk_events} рискованных операций.`,
  };
}

export function buildErrorChartExplain(
  scenarios: ScenarioMetric[],
  scenarioLabel: (key: string) => string,
  lang: Language
): ChartExplainContent {
  const totalFn = scenarios.reduce((acc, s) => acc + s.false_negatives, 0);
  const totalFp = scenarios.reduce((acc, s) => acc + s.false_positives, 0);
  const topErr = [...scenarios]
    .sort((a, b) => b.false_negatives + b.false_positives - (a.false_negatives + a.false_positives))[0];

  if (totalFn === 0 && totalFp === 0) {
    return lang === "en"
      ? {
          shortSummary: "Zero misses (FN) and zero false blocks (FP) across all scenarios.",
          attentionPoint: "No error concentration detected on this sample.",
          whatShows: "Shows where the antifraud engine made mistakes and which error type occurred more often.",
          detailedMeaning: "No false negatives or false positives were recorded in any scenario.",
        }
      : lang === "kk"
        ? {
            shortSummary: "Барлық сценарийлерде өткізу (FN) де, жалған бұғаттау (FP) да тіркелмеді.",
            attentionPoint: "Бұл жинақта қателер шоғырлануы жоқ.",
            whatShows: "Антифрод қандай жағдайларда қателескенін және қай қате түрі жиі кездескенін көрсетеді.",
            detailedMeaning: "Бірде-бір сценарийде өткізу немесе жалған бұғаттау болмады.",
          }
        : {
            shortSummary: "Ошибок (пропусков и ложных блокировок) по сценариям не зафиксировано.",
            attentionPoint: "На данной выборке проблемных зон нет.",
            whatShows: "Этот график показывает, в каких ситуациях антифрод ошибался и какие ошибки встречались чаще.",
            detailedMeaning: "Ни один сценарий не дал пропущенных угроз или ложных блокировок.",
          };
  }

  const domType =
    totalFn >= totalFp
      ? lang === "en"
        ? "missed risky operations (FN)"
        : lang === "kk"
          ? "өткізілген қауіпті операциялар (FN)"
          : "пропуски рискованных операций (FN)"
      : lang === "en"
        ? "false blocks on legitimate payments (FP)"
        : lang === "kk"
          ? "заңды төлемдерді қате бұғаттау (FP)"
          : "ложные блокировки обычных платежей (FP)";

  const topName = topErr ? scenarioLabel(topErr.scenario_type) : "";
  if (lang === "en") {
    return {
      shortSummary: `Total errors: ${totalFn} misses (FN) and ${totalFp} false blocks (FP).`,
      attentionPoint: `Most errors are ${domType}${topName ? `, led by «${topName}»` : ""}.`,
      whatShows: "Shows in which situations the antifraud engine made mistakes and which error type occurred more often.",
      detailedMeaning: `Across all scenarios, ${totalFn} risky operations were missed and ${totalFp} legitimate operations were falsely flagged.`,
    };
  }
  if (lang === "kk") {
    return {
      shortSummary: `Барлық қателер: ${totalFn} өткізу (FN) және ${totalFp} жалған бұғаттау (FP).`,
      attentionPoint: `Басым қате түрі — ${domType}${topName ? ` («${topName}» сценарийінде)` : ""}.`,
      whatShows: "Бұл график антифродтың қандай жағдайларда қателескенін және қай қате түрі жиірек кездескенін көрсетеді.",
      detailedMeaning: `Барлық сценарийлер бойынша ${totalFn} қауіпті операция өткізіліп, ${totalFp} заңды операция қате бұғатталды.`,
    };
  }
  return {
    shortSummary: `Всего ошибок: ${totalFn} пропусков (FN) и ${totalFp} ложных блокировок (FP).`,
    attentionPoint: `Преобладают ${domType}${topName ? `, больше всего в сценарии «${topName}»` : ""}.`,
    whatShows: "Этот график показывает, в каких ситуациях антифрод ошибался и какие ошибки встречались чаще.",
    detailedMeaning: `Суммарно по сценариям система пропустила ${totalFn} рискованных операций и ошибочно отметила ${totalFp} обычных.`,
  };
}

export function buildRiskDistChartExplain(
  available: boolean,
  buckets: RiskDistributionBucket[],
  lang: Language
): ChartExplainContent | null {
  if (!available || buckets.length === 0) return null;
  const overlapBuckets = buckets.filter((b) => b.legitimate > 0 && b.risky > 0);
  const topOverlap = [...overlapBuckets].sort(
    (a, b) => Math.min(b.legitimate, b.risky) - Math.min(a.legitimate, a.risky)
  )[0];
  const lowScoreRisky = buckets
    .filter((b) => b.min_score < 50)
    .reduce((acc, b) => acc + b.risky, 0);

  if (lang === "en") {
    return {
      shortSummary: topOverlap
        ? `Risky and legitimate operations overlap most in score band ${topOverlap.range}.`
        : "Risky and legitimate operations are cleanly separated by risk score.",
      attentionPoint:
        lowScoreRisky > 0
          ? `${lowScoreRisky} risky test operations received scores below 50.`
          : "No risky test operations fell into the low-score band (< 50).",
      whatShows: "Risk Score measures how suspicious an operation looks to the engine (0–100). Higher scores mean higher estimated risk.",
      detailedMeaning: topOverlap
        ? `In band ${topOverlap.range}, both legitimate (${topOverlap.legitimate}) and risky (${topOverlap.risky}) operations received similar scores, making threshold selection a trade-off.`
        : "Legitimate and risky operations occupy mostly separate score ranges.",
    };
  }
  if (lang === "kk") {
    return {
      shortSummary: topOverlap
        ? `Қауіпті және заңды операциялардың бағасы ${topOverlap.range} диапазонында қиылысады.`
        : "Қауіпті және заңды операциялар Risk Score бойынша жақсы ажыратылған.",
      attentionPoint:
        lowScoreRisky > 0
          ? `${lowScoreRisky} қауіпті тест операциясы 50-ден төмен балл алды.`
          : "Төмен балл (< 50) алған қауіпті операциялар жоқ.",
      whatShows: "Risk Score — операцияның күдіктілік бағасы (0–100). Мән неғұрлым жоғары болса, жүйе бағасы бойынша тәуекел соғұрлым жоғары.",
      detailedMeaning: topOverlap
        ? `${topOverlap.range} аралығында заңды (${topOverlap.legitimate}) және қауіпті (${topOverlap.risky}) операциялар ұқсас баға алған — бұл шек таңдауда ымыра тудырады.`
        : "Заңды және қауіпті операциялар негізінен әртүрлі балл аймақтарында орналасқан.",
    };
  }
  return {
    shortSummary: topOverlap
      ? `Рискованные и обычные операции чаще всего пересекаются по оценке в диапазоне ${topOverlap.range}.`
      : "Рискованные и обычные операции хорошо разделены по оценке риска.",
    attentionPoint:
      lowScoreRisky > 0
        ? `${lowScoreRisky} рискованных тестовых операций получили низкий балл (< 50).`
        : "Рискованных операций в зоне низкого балла (< 50) нет.",
    whatShows: "Risk Score — оценка подозрительности операции (0–100). Чем выше значение, тем выше риск по оценке проверяемой системы.",
    detailedMeaning: topOverlap
      ? `В диапазоне ${topOverlap.range} похожие оценки получили и обычные (${topOverlap.legitimate}), и рискованные (${topOverlap.risky}) операции — поэтому простое снижение порога может увеличить ложные блокировки.`
      : "Оценки обычных и рискованных операций почти не пересекаются.",
  };
}

export function buildDefenseComparisonChartExplain(
  baseline: MetricsSummary,
  candidate: MetricsSummary,
  lang: Language
): ChartExplainContent {
  const tpDiff = candidate.true_positives - baseline.true_positives;
  const fpDiff = candidate.false_positives - baseline.false_positives;
  const recPp = (candidate.recall - baseline.recall) * 100;
  const precPp = (candidate.precision - baseline.precision) * 100;

  if (lang === "en") {
    return {
      shortSummary: `Recall ${recPp >= 0 ? "+" : ""}${recPp.toFixed(1)} pp (${tpDiff >= 0 ? "+" : ""}${tpDiff} risky ops), false blocks ${fpDiff >= 0 ? "+" : ""}${fpDiff}.`,
      attentionPoint:
        fpDiff > 0 || precPp < -0.5
          ? `Trade-off: ${fpDiff > 0 ? `+${fpDiff} new false blocks` : ""}${precPp < -0.5 ? ` Precision ${precPp.toFixed(1)} pp` : ""}.`
          : tpDiff > 0
            ? "Detection improved without adding false blocks."
            : "No net improvement in detection on this control set.",
      whatShows: "Compares the baseline and proposed configurations on the exact same held-out evaluation operations.",
      detailedMeaning: `Baseline caught ${baseline.true_positives} risky test ops (${baseline.false_positives} FP); candidate caught ${candidate.true_positives} (${candidate.false_positives} FP).`,
    };
  }
  if (lang === "kk") {
    return {
      shortSummary: `Recall ${recPp >= 0 ? "+" : ""}${recPp.toFixed(1)} п. т. (${tpDiff >= 0 ? "+" : ""}${tpDiff} қауіпті оп.), жалған бұғаттау ${fpDiff >= 0 ? "+" : ""}${fpDiff}.`,
      attentionPoint:
        fpDiff > 0 || precPp < -0.5
          ? `Ымыра: ${fpDiff > 0 ? `+${fpDiff} жаңа жалған бұғаттау` : ""}${precPp < -0.5 ? ` Precision ${precPp.toFixed(1)} п. т.` : ""}.`
          : tpDiff > 0
            ? "Жалған бұғаттау өспей, анықтау жақсарды."
            : "Бақылау жинағында анықтау өсімі тіркелмеді.",
      whatShows: "Бастапқы және ұсынылған конфигурацияларды бірдей бақылау операциялары жинағында салыстырады.",
      detailedMeaning: `Бастапқы нұсқа ${baseline.true_positives} қауіпті операция тапты (${baseline.false_positives} FP); жаңа нұсқа ${candidate.true_positives} тапты (${candidate.false_positives} FP).`,
    };
  }
  return {
    shortSummary: `Обнаружение ${recPp >= 0 ? "+" : ""}${recPp.toFixed(1).replace(".", ",")} п. п. (${tpDiff >= 0 ? "+" : ""}${tpDiff} риск. оп.), ложные блокировки ${fpDiff >= 0 ? "+" : ""}${fpDiff}.`,
    attentionPoint:
      fpDiff > 0 || precPp < -0.5
        ? `Компромисс: ${fpDiff > 0 ? `+${fpDiff} нов. ложн. блокир.` : ""}${precPp < -0.5 ? ` Precision ${precPp.toFixed(1).replace(".", ",")} п. п.` : ""}.`
        : tpDiff > 0
          ? "Обнаружение выросло без роста ложных блокировок."
          : "Значимого прироста обнаружения на контрольном наборе не получено.",
    whatShows: "Сравниваем исходную и предложенную конфигурации на одном контрольном наборе операций (evaluation split).",
    detailedMeaning: `Исходная версия нашла ${baseline.true_positives} рискованных тестовых операций (FP: ${baseline.false_positives}), новая — ${candidate.true_positives} (FP: ${candidate.false_positives}).`,
  };
}

export function buildStabilityChartExplain(
  perSeed: BenchmarkSeedResult[],
  lang: Language
): ChartExplainContent {
  const n = perSeed.length;
  const hasCand = perSeed.some((p) => Boolean(p.candidate));
  const wins = hasCand
    ? perSeed.filter((p) => (p.candidate?.recall ?? 0) > p.baseline.recall + 0.001).length
    : 0;

  if (lang === "en") {
    return {
      shortSummary: hasCand
        ? `Candidate beat baseline Recall on ${wins} of ${n} independent test seeds.`
        : `Evaluated baseline consistency across ${n} independent synthetic datasets.`,
      attentionPoint:
        hasCand && wins < Math.ceil(n / 2)
          ? "Improvement did not repeat consistently across most test sets."
          : "Results across independent seeds show how stable performance is.",
      whatShows: "Checks whether results repeat across different test datasets instead of relying on a single lucky run.",
      detailedMeaning: `Each bar pair represents a separate synthetic dataset (seed). Consistent gains across seeds confirm robustness.`,
    };
  }
  if (lang === "kk") {
    return {
      shortSummary: hasCand
        ? `Үміткер ${n} тәуелсіз жинақтың ${wins}-інде бастапқы Recall көрсеткішінен асты.`
        : `Бастапқы нұсқаның тұрақтылығы ${n} тәуелсіз жинақта тексерілді.`,
      attentionPoint:
        hasCand && wins < Math.ceil(n / 2)
          ? "Жақсару көпшілік жинақтарда тұрақты қайталанбады."
          : "Тәуелсіз жинақтар нәтиженің тұрақтылығын көрсетеді.",
      whatShows: "Нәтиженің бір ғана сәтті прогонға емес, әртүрлі тест жинақтарында қайталануын тексереді.",
      detailedMeaning: `Әр баған жеке синтетикалық жинақты (seed) білдіреді.`,
    };
  }
  return {
    shortSummary: hasCand
      ? `Новая версия превзошла исходную по Recall на ${wins} из ${n} независимых тестовых наборов.`
      : `Проверена повторяемость исходной защиты на ${n} независимых тестовых наборах.`,
    attentionPoint:
      hasCand && wins < Math.ceil(n / 2)
        ? "Улучшение повторилось меньше чем в половине запусков — результат нестабилен."
        : "Повторяемость по разным наборам показывает, насколько можно доверять результату.",
    whatShows: "Проверяем, повторяется ли результат при разных тестовых наборах, а не зависит ли он от одного удачного запуска.",
    detailedMeaning: `Каждый прогон использует отдельный независимый синтетический набор (seed). Стабильный выигрыш на большинстве наборов подтверждает надёжность настроек.`,
  };
}

/**
 * 3. Plain-language 3-question story for each Weakness item.
 */
export function buildWeaknessPlainStory(
  scenarioName: string,
  missedCount: number,
  actualRisk: number,
  fpCount: number,
  isFpWeakness: boolean,
  isBlackBox: boolean,
  lang: Language,
  scenarioKey?: string
): WeaknessPlainStory {
  const lower = `${scenarioKey || ""} ${scenarioName}`.toLowerCase();
  const isStructuring = lower.includes("structuring") || lower.includes("smurf") || lower.includes("дроблен") || lower.includes("бөлшек");
  const isAto = lower.includes("takeover") || lower.includes("_ato") || lower.includes("(ato)") || lower.includes("захват") || lower.includes("басып");

  if (isFpWeakness) {
    if (lang === "en") {
      return {
        whatHappened: `In «${scenarioName}», ${fpCount} legitimate customer operations were flagged as risky by mistake.`,
        whyProblem: "False blocks decline normal payments, frustrate customers, and add manual review load.",
        whatToCheck: isBlackBox
          ? "Vendor rules are sealed (Black-Box). Calibrate external review/block cutoffs and send these flagged IDs to the external team."
          : "Review rule weights and thresholds affecting this scenario to reduce over-triggering on normal transfers.",
      };
    }
    if (lang === "kk") {
      return {
        whatHappened: `«${scenarioName}» сценарийінде ${fpCount} заңды операция қате бұғатталды.`,
        whyProblem: "Жалған бұғаттаулар клиенттердің қалыпты төлемдерін тоқтатып, қолдау жүктемесін арттырады.",
        whatToCheck: isBlackBox
          ? "Ішкі ережелер жабық (Black-Box). Сыртқы шекті / Review аймағын реттеп, операция кодтарын вендор тобына жіберіңіз."
          : "Осы сценарийге әсер ететін ереже салмақтары мен шектерін тексеру қажет.",
      };
    }
    const fpMod10 = fpCount % 10;
    const fpMod100 = fpCount % 100;
    const fpStoryPhrase =
      fpMod10 === 1 && fpMod100 !== 11
        ? `${fpCount} обычную операцию как рискованную`
        : fpMod10 >= 2 && fpMod10 <= 4 && (fpMod100 < 12 || fpMod100 > 14)
          ? `${fpCount} обычные операции как рискованные`
          : `${fpCount} обычных операций как рискованные`;
    return {
      whatHappened: `В сценарии «${scenarioName}» система ошибочно пометила ${fpStoryPhrase}.`,
      whyProblem: "Ложные блокировки мешают обычным клиентам проводить платежи и увеличивают нагрузку на поддержку.",
      whatToCheck: isBlackBox
        ? "Внутренние правила скрыты (Black-Box). Можно скорректировать внешний порог / зону Review и передать примеры операций команде вендора."
        : "Проверьте пороги и веса правил, срабатывающих в этом сценарии, чтобы не задевать типичные платежи.",
    };
  }

  if (lang === "en") {
    const whyProblem = isStructuring
      ? "Attackers split a large payout into 3–5 transfers right below the standard threshold so single transactions look harmless."
      : isAto
        ? "After switching device or geo location, a hijacked session quickly drains funds to a new payee using an atypical amount."
        : "Missed risky patterns pass through without review, increasing exposure to this transfer pattern.";
    const bbCheck = "Internal vendor rules stay untouched (Black-Box). Optimize the external risk_score cutoff / Allow–Review–Block routing or send sample IDs to the vendor team.";
    const wbCheck = isStructuring
      ? "Widen the structuring window, lower the split transfer count threshold (e.g. 4 → 3), and raise rule weight."
      : isAto
        ? "Extend post-device/geo lookback window and raise ATO rule weight for new-payee payouts."
        : "Inspect the rule threshold, lookback window, and score weight for this scenario via «Antifraud Improvement».";
    return {
      whatHappened: `In «${scenarioName}», ${missedCount} of ${actualRisk} risky test operations went undetected.`,
      whyProblem,
      whatToCheck: isBlackBox ? bbCheck : wbCheck,
    };
  }
  if (lang === "kk") {
    const whyProblem = isStructuring
      ? "Шабуылдаушылар ірі соманы стандартты шектен сәл төмен 3–5 аударымға бөліп, жеке тексеруден өтіп кетеді."
      : isAto
        ? "Құрылғыны немесе геолокацияны ауыстырғаннан кейін жаңа алушыға әдеттен тыс соманы жылдам шығару дер кезінде тоқтатылмады."
        : "Байқалмаған қауіпті операциялар тексерусіз өтіп кетуі мүмкін.";
    const bbCheck = "Ішкі ережелер жабық (Black-Box). Тек сыртқы risk_score шегі / Allow–Review–Block бағыттауын баптаңыз немесе мысалдарды вендорға жолдаңыз.";
    const wbCheck = isStructuring
      ? "Бөлшектеу терезесін кеңейтіп, сериядағы аударымдар шегін төмендетіп (4 → 3), ереже салмағын арттыру ұсынылады."
      : isAto
        ? "Құрылғы/гео ауысқаннан кейінгі бақылау терезесін ұзартып, ATO ережесінің салмағын күшейту қажет."
        : "«Антифродты жақсарту» бөлімінде осы сценарийдің шектері мен салмақтарын тексеріңіз.";
    return {
      whatHappened: `«${scenarioName}» сценарийінде ${actualRisk} қауіпті операцияның ${missedCount}-і өткізіліп алынды.`,
      whyProblem,
      whatToCheck: isBlackBox ? bbCheck : wbCheck,
    };
  }
  const whyProblemRu = isStructuring
    ? "Злоумышленники дробят крупный перевод на 3–5 частей чуть ниже стандартного порога риска — каждая операция по отдельности выглядит незаметной."
    : isAto
      ? "После смены устройства или геопозиции выполняется быстрый перевод новому получателю на нетипичную сумму, минуя статические пороги."
      : "Такие операции проходят без предупреждения — на этом типе переводов защита остаётся уязвимой.";
  const bbCheckRu = "Внутренние правила в Black-Box не изменяются: настройте внешний порог risk_score и маршрутизацию Allow / Review / Block или передайте примеры команде вендора.";
  const wbCheckRu = isStructuring
    ? "Расширьте окно контроля дробления, снизьте порог серии переводов (4 → 3) и усильте вес правила structuring_smurfing."
    : isAto
      ? "Увеличьте окно после смены устройства/гео, снизьте порог нетипичной суммы для нового получателя и усильте вес правила account_takeover_ato."
      : "Проверьте чувствительность правила (порог, окно времени и вес) в блоке «Улучшение антифрода».";
  return {
    whatHappened: `В сценарии «${scenarioName}» пропущено ${missedCount} из ${actualRisk} рискованных тестовых операций.`,
    whyProblem: whyProblemRu,
    whatToCheck: isBlackBox ? bbCheckRu : wbCheckRu,
  };
}

/**
 * 4. Plain-language Stage D result story for Comparison Block (Evaluation Split).
 */
export function buildComparisonPlainStory(
  baseline: MetricsSummary,
  candidate: MetricsSummary,
  verdict: string,
  scenarioComparison: ScenarioComparisonItem[],
  scenarioLabel: (key: string) => string,
  lang: Language
): ComparisonPlainStory {
  const tpDiff = candidate.true_positives - baseline.true_positives;
  const fpDiff = candidate.false_positives - baseline.false_positives;
  const remMisses = candidate.false_negatives;
  const precDrop = (candidate.precision - baseline.precision) * 100;
  const savedMoney =
    (candidate.prevented_fraud_amount ?? 0) - (baseline.prevented_fraud_amount ?? 0);
  const fmtCompactKzt = (val: number) =>
    `${new Intl.NumberFormat(lang === "en" ? "en-US" : "ru-KZ", {
      maximumFractionDigits: 0,
    }).format(Math.round(Math.abs(val)))} ₸`;

  const improvedScens = scenarioComparison
    .filter((s) => (s.fn_delta ?? 0) < 0)
    .map((s) => scenarioLabel(s.scenario_type));
  const unchangedWeakScens = scenarioComparison
    .filter((s) => (s.candidate_fn ?? 0) > 0 && (s.fn_delta ?? 0) >= 0)
    .map((s) => scenarioLabel(s.scenario_type));

  const tone: ComparisonPlainStory["tone"] =
    verdict === "improved" && fpDiff <= 0 && precDrop >= -0.5
      ? "good"
      : verdict === "rejected_regression" || tpDiff < 0
        ? "danger"
        : "warn";

  if (lang === "en") {
    const lead =
      tpDiff > 0
        ? `The new version detected ${tpDiff} more risky test ${tpDiff === 1 ? "operation" : "operations"} (still missed: ${remMisses})`
        : tpDiff === 0
          ? `Detection count did not change (still missed: ${remMisses})`
          : `The new version detected ${Math.abs(tpDiff)} fewer risky test operations (missed: ${remMisses})`;
    const fpText =
      fpDiff > 0
        ? `, but falsely flagged ${fpDiff} more legitimate ${fpDiff === 1 ? "operation" : "operations"}.`
        : fpDiff < 0
          ? ` and reduced false blocks by ${Math.abs(fpDiff)}.`
          : " with no new false blocks.";
    const scenNote =
      improvedScens.length > 0
        ? ` Improved: ${improvedScens.join(", ")}.`
        : "";
    const remNote =
      unchangedWeakScens.length > 0
        ? ` Still unfixed: ${unchangedWeakScens.join(", ")}.`
        : "";
    const moneyNote =
      savedMoney > 0
        ? ` Prevented +${fmtCompactKzt(savedMoney)} additional fraud.`
        : savedMoney < 0
          ? ` Prevented ${fmtCompactKzt(savedMoney)} less fraud.`
          : "";

    const shouldAdopt =
      verdict === "improved"
        ? fpDiff > 0 || precDrop < -0.5
          ? "Passed active guardrails, but sensitivity rose alongside minor precision/FPR trade-offs — review before rollout."
          : "Passed all active guardrails with net improvement on held-out evaluation."
        : verdict === "mixed"
          ? "Mixed trade-off: requires manual specialist review before applying."
          : verdict === "rejected_regression"
            ? "Do not adopt: failed safety guardrails or degraded performance."
            : "Improvement was not confirmed on the held-out evaluation split.";

    return { headline: `${lead}${fpText}${moneyNote}${scenNote}${remNote}`, shouldAdopt, tone };
  }

  if (lang === "kk") {
    const lead =
      tpDiff > 0
        ? `Жаңа нұсқа қосымша ${tpDiff} қауіпті тест операциясын анықтады (әлі өткізілгені: ${remMisses})`
        : tpDiff === 0
          ? `Анықталған қауіптер саны өзгермеді (әлі өткізілгені: ${remMisses})`
          : `Жаңа нұсқа ${Math.abs(tpDiff)} қауіпті операцияны аз анықтады (өткізілгені: ${remMisses})`;
    const fpText =
      fpDiff > 0
        ? `, бірақ тағы ${fpDiff} заңды операцияны қате белгіледі.`
        : fpDiff < 0
          ? ` және жалған бұғаттауды ${Math.abs(fpDiff)}-ге азайтты.`
          : ", жаңа жалған бұғаттау пайда болмады.";
    const moneyNote =
      savedMoney > 0
        ? ` Қосымша +${fmtCompactKzt(savedMoney)} фрод тоқтатылды.`
        : savedMoney < 0
          ? ` Қорғалған сома ${fmtCompactKzt(savedMoney)}-ға азайды.`
          : "";
    const shouldAdopt =
      verdict === "improved"
        ? fpDiff > 0 || precDrop < -0.5
          ? "Шектеулерден (guardrails) өтті, бірақ сезімталдықпен бірге жекелеген көрсеткіштерде ымыра бар — енгізер алдында бағалау қажет."
          : "Барлық қауіпсіздік шектеулерінен өтті, бақылау жинағында оң нәтиже расталды."
        : verdict === "mixed"
          ? "Аралас нәтиже: енгізбес бұрын маман тексеруі қажет."
          : verdict === "rejected_regression"
            ? "Қабылдауға болмайды: конфигурация шектеулерден өтпеді немесе сапаны төмендетті."
            : "Бақылау жинағында жақсару расталмады.";
    return { headline: `${lead}${fpText}${moneyNote}`, shouldAdopt, tone };
  }

  // Russian
  const lead =
    tpDiff > 0
      ? `Новая версия обнаружила на ${tpDiff} ${tpDiff === 1 ? "рискованную тестовую операцию" : tpDiff < 5 ? "рискованные тестовые операции" : "рискованных тестовых операций"} больше (осталось пропусков: ${remMisses})`
      : tpDiff === 0
        ? `Количество обнаруженных рискованных операций не изменилось (осталось пропусков: ${remMisses})`
        : `Новая версия обнаружила на ${Math.abs(tpDiff)} рискованных операций меньше (пропусков: ${remMisses})`;
  const fpText =
    fpDiff > 0
      ? `, но ошибочно пометила ещё ${fpDiff} ${fpDiff === 1 ? "законную операцию" : "законных операций"}.`
      : fpDiff < 0
        ? ` и сократила ложные блокировки на ${Math.abs(fpDiff)}.`
        : ", новых ложных блокировок не появилось.";
  const scenNote =
    improvedScens.length > 0 ? ` Лучше сработали: ${improvedScens.join(", ")}.` : "";
  const remNote =
    unchangedWeakScens.length > 0
      ? ` Без улучшений остались: ${unchangedWeakScens.join(", ")}.`
      : "";
  const moneyNote =
    savedMoney > 0
      ? ` Дополнительно защищено: +${fmtCompactKzt(savedMoney)}.`
      : savedMoney < 0
        ? ` Сумма перехвата снизилась на ${fmtCompactKzt(savedMoney)}.`
        : "";

  const shouldAdopt =
    verdict === "improved"
      ? fpDiff > 0 || precDrop < -0.5
        ? "Конфигурация прошла заданные ограничения (guardrails), однако чувствительность выросла ценой небольшого ухудшения Precision/FPR — перед применением оцените этот компромисс."
        : "Конфигурация прошла все ограничения (guardrails) и подтвердила улучшение на контрольной выборке."
      : verdict === "mixed"
        ? "Есть заметный компромисс по метрикам — принимать без ручной проверки специалиста не рекомендуется."
        : verdict === "rejected_regression"
          ? "Принимать изменения нельзя: конфигурация нарушила ограничения безопасности или ухудшила качество."
          : "Улучшение не подтверждено на контрольной выборке — оставайтесь на исходной версии.";

  return {
    headline: `${lead}${fpText}${moneyNote}${scenNote}${remNote}`,
    shouldAdopt,
    tone,
  };
}

/**
 * 5. Compact 1-line human summary for History Drawer cards.
 */
export function buildHistoryItemSummary(
  exp: ExperimentSummary,
  lang: Language
): string {
  const m = exp.metrics_json;
  if (m.actual_risk_events === 0) {
    return lang === "en"
      ? `0 risky cases · ${m.false_positives} false blocks`
      : lang === "kk"
        ? `0 қауіпті жағдай · ${m.false_positives} жалған бұғаттау`
        : `0 рискованных кейсов · ${m.false_positives} ложных блокировок`;
  }
  if (lang === "en") {
    return `Caught ${m.true_positives}/${m.actual_risk_events} risky ops · ${m.false_negatives} missed · ${m.false_positives} false blocks`;
  }
  if (lang === "kk") {
    return `${m.actual_risk_events} ішінен ${m.true_positives} табылды · ${m.false_negatives} өткізілді · ${m.false_positives} FP`;
  }
  return `Найдено ${m.true_positives} из ${m.actual_risk_events} угроз · пропущено ${m.false_negatives} · ложных блокировок ${m.false_positives}`;
}
