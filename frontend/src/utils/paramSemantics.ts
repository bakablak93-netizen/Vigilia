import type { Language } from "../i18n/translations";

export type DefenseMechanismKey =
  | "duplicate_payment"
  | "new_recipient_risk"
  | "unusual_amount"
  | "suspicious_sequence"
  | "structuring_smurfing"
  | "account_takeover_ato"
  | "black_box_routing"
  | "decision_threshold";

interface ParamSemanticSpec {
  mechanism: DefenseMechanismKey;
  humanName: Record<Language, string>;
  purpose: Record<Language, string>;
  higherEffect: Record<Language, string>;
  lowerEffect: Record<Language, string>;
  sideEffect: Record<Language, string>;
}

const PARAM_CATALOG: Record<string, ParamSemanticSpec> = {
  duplicate_window_min: {
    mechanism: "duplicate_payment",
    humanName: {
      ru: "Временное окно проверки повторов (мин)",
      kk: "Қайталауды тексеру уақыт терезесі (мин)",
      en: "Duplicate detection window (min)",
    },
    purpose: {
      ru: "Задаёт интервал времени, в пределах которого повторный перевод тому же получателю считается дубликатом.",
      kk: "Бір алушыға қайталанған аударым қайталама деп саналатын уақыт аралығын белгілейді.",
      en: "Time interval within which a repeated transfer to the same recipient counts as a duplicate.",
    },
    higherEffect: {
      ru: "Расширение окна охватывает отложенные повторы с большей паузой между операциями.",
      kk: "Терезені кеңейту үзілісі үлкенірек қайталанатын аударымдарды қамтуға мүмкіндік береді.",
      en: "Widening the window catches delayed repeat transfers spread further apart in time.",
    },
    lowerEffect: {
      ru: "Сужение окна ограничивает поиск дублей более коротким промежутком времени.",
      kk: "Терезені тарылту қайталама іздеуді қысқа уақытпен шектейді.",
      en: "Narrowing the window restricts duplicate matching to a shorter interval.",
    },
    sideEffect: {
      ru: "Регулярные законные переводы одному получателю в пределах нового окна могут чаще помечаться как повторы.",
      kk: "Жаңа терезе ішіндегі заңды тұрақты төлемдер қайталама ретінде жиірек белгіленуі мүмкін.",
      en: "Legitimate repeat transfers to the same recipient inside the wider window may trigger false alerts.",
    },
  },
  duplicate_tolerance_pct: {
    mechanism: "duplicate_payment",
    humanName: {
      ru: "Допуск отклонения суммы дубликата",
      kk: "Қайталама сомасының ауытқу шегі",
      en: "Duplicate amount tolerance (%)",
    },
    purpose: {
      ru: "Допустимая относительная разница сумм (в долях), при которой два перевода считаются похожими по сумме.",
      kk: "Екі аударым сомасы ұқсас деп танылатын рұқсат етілген салыстырмалы айырмашылық.",
      en: "Allowed relative amount variance within which two transfers are matched as near-duplicates.",
    },
    higherEffect: {
      ru: "Увеличение допуска расширяет диапазон совпадения — ловит дубли со слегка изменённой суммой, но ослабляет точность отбора.",
      kk: "Шекті үлкейту сәйкестік диапазонын кеңейтеді — сомасы сәл өзгерген қайталауларды ұстайды, бірақ сүзгі дәлдігін төмендетеді.",
      en: "Raising tolerance widens the match band: catches slightly altered amounts while loosening exact-match strictness.",
    },
    lowerEffect: {
      ru: "Уменьшение допуска делает проверку суммы более строгой — совпадают только почти одинаковые суммы.",
      kk: "Шекті азайту тексеруді қатайтады — тек дерлік бірдей сомалар сәйкес келеді.",
      en: "Lowering tolerance tightens amount matching to near-identical amounts only.",
    },
    sideEffect: {
      ru: "Более широкий допуск повышает риск связать две независимые обычные покупки с похожими суммами.",
      kk: "Кеңірек ауытқу шегі ұқсас чекті екі бөлек заңды сатып алуды байланыстыру қаупін арттырады.",
      en: "A wider tolerance may merge unrelated legitimate purchases that happen to have close amounts.",
    },
  },
  duplicate_weight: {
    mechanism: "duplicate_payment",
    humanName: {
      ru: "Вес правила повторных платежей",
      kk: "Қайталанатын төлем ережесінің салмағы",
      en: "Duplicate payment rule weight",
    },
    purpose: {
      ru: "Вклад сигнала о повторном платеже в итоговый балл риска (risk score).",
      kk: "Қайталанатын төлем сигналының жалпы тәуекел балына қосатын үлесі.",
      en: "Risk score points added when the duplicate payment detector triggers.",
    },
    higherEffect: {
      ru: "Повышение веса усиливает влияние выявленного дубликата на решение о блокировке.",
      kk: "Салмақты арттыру табылған қайталаманың бұғаттау шешіміне әсерін күшейтеді.",
      en: "Increasing the weight makes a duplicate detection contribute more heavily toward blocking.",
    },
    lowerEffect: {
      ru: "Снижение веса требует подтверждения от других факторов риска для блокировки.",
      kk: "Салмақты азайту бұғаттау үшін қосымша тәуекел факторларын талап етеді.",
      en: "Lowering the weight requires corroboration from other risk signals to cross the block threshold.",
    },
    sideEffect: {
      ru: "Высокий вес может вызывать ложную блокировку при единичном случайном повторе перевода.",
      kk: "Жоғары салмақ кездейсоқ қайталанған аударымдарды жалған бұғаттауға әкелуі мүмкін.",
      en: "High weight can trigger false positives on an accidental legitimate repeat payment.",
    },
  },
  new_payee_weight: {
    mechanism: "new_recipient_risk",
    humanName: {
      ru: "Вес фактора нового получателя",
      kk: "Жаңа алушы факторының салмағы",
      en: "New recipient weight",
    },
    purpose: {
      ru: "Балл риска, начисляемый при переводе ранее не встречавшемуся получателю (с учётом суммы и канала).",
      kk: "Бұрын кездеспеген жаңа алушыға аударым кезінде қосылатын тәуекел балы.",
      en: "Risk score added when transferring to a previously unseen recipient.",
    },
    higherEffect: {
      ru: "Повышение веса усиливает оценку риска для переводов новым контрагентам и физлицам.",
      kk: "Салмақты арттыру жаңа алушыларға жасалатын аударымдардың тәуекел бағасын көтереді.",
      en: "Increasing weight raises risk scores assigned to transfers to first-time recipients.",
    },
    lowerEffect: {
      ru: "Снижение веса смягчает реакцию на новых получателей при отсутствии прочих аномалий.",
      kk: "Салмақты азайту басқа ауытқулар болмаса, жаңа алушыларға реакцияны жұмсартады.",
      en: "Lowering weight softens scoring on new recipients when no secondary anomalies exist.",
    },
    sideEffect: {
      ru: "Повышает вероятность ложных отказов при законных первых переводах новым получателям.",
      kk: "Жаңа контрагенттерге жасалған заңды алғашқы төлемдерді қате бұғаттау ықтималдығы артады.",
      en: "Increases false blocks on legitimate first-time payments to new recipients.",
    },
  },
  night_bonus: {
    mechanism: "new_recipient_risk",
    humanName: {
      ru: "Надбавка за ночное время",
      kk: "Түнгі уақыт үстемесі",
      en: "Night-hours risk bonus",
    },
    purpose: {
      ru: "Дополнительный штраф к риску за операции в ночные часы (00:00–06:00), особенно новым получателям.",
      kk: "Түнгі уақытта (00:00–06:00), әсіресе жаңа алушыларға жасалған операцияларға қосылатын қосымша балл.",
      en: "Extra risk points applied to transfers between 00:00 and 06:00, especially to new payees.",
    },
    higherEffect: {
      ru: "Увеличение ночной надбавки усиливает чувствительность к ночным операциям.",
      kk: "Түнгі үстемені арттыру түнгі операцияларға сезімталдықты күшейтеді.",
      en: "Raising the bonus increases sensitivity to off-hours transfers.",
    },
    lowerEffect: {
      ru: "Уменьшение ночной надбавки ослабляет влияние времени суток на скоринг.",
      kk: "Түнгі үстемені азайту тәулік уақытының скорингке әсерін төмендетеді.",
      en: "Lowering the bonus reduces time-of-day penalty on overnight activity.",
    },
    sideEffect: {
      ru: "Клиенты, реально совершающие переводы ночью (или из другого часового пояса), чаще попадают под проверку.",
      kk: "Түнде заңды аударым жасайтын клиенттер жиірек тексеруге ілігуі мүмкін.",
      en: "Legitimate customers transacting overnight or across timezones face more false alerts.",
    },
  },
  amount_tier_scale: {
    mechanism: "unusual_amount",
    humanName: {
      ru: "Масштаб ориентира нормальной суммы",
      kk: "Қалыпты сома бағдарының масштабы",
      en: "Amount baseline scale multiplier",
    },
    purpose: {
      ru: "Множитель, определяющий расчётную норму суммы относительно сегмента и истории клиента (EWMA).",
      kk: "Клиент сегменті мен тарихына (EWMA) қатысты қалыпты сома шегін есептейтін көбейткіш.",
      en: "Multiplier scaling the customer segment & EWMA reference amount baseline.",
    },
    higherEffect: {
      ru: "Увеличение множителя поднимает границу нормы — правило аномальной суммы срабатывает реже.",
      kk: "Көбейткішті өсіру қалыпты шекті көтереді — әдеттен тыс сома ережесі сирек қосылады.",
      en: "Raising the scale lifts the normal reference cap, making the amount check more permissive.",
    },
    lowerEffect: {
      ru: "Снижение множителя опускает границу нормы суммы — аномалии по сумме начинают фиксироваться раньше.",
      kk: "Көбейткішті төмендету қалыпты сома шегін түсіреді — ауытқулар ертерек анықталады.",
      en: "Lowering the scale drops the normal threshold, flagging smaller relative amount spikes.",
    },
    sideEffect: {
      ru: "Заниженный ориентир может вызывать ложные срабатывания при законных крупных покупках.",
      kk: "Тым төмен шек заңды ірі сатып алулар кезінде жалған дабыл тудыруы мүмкін.",
      en: "An overly tight scale can falsely flag legitimate large transfers.",
    },
  },
  amount_weight: {
    mechanism: "unusual_amount",
    humanName: {
      ru: "Вес фактора необычной суммы",
      kk: "Әдеттен тыс сома факторының салмағы",
      en: "Unusual amount weight",
    },
    purpose: {
      ru: "Вклад правила аномальной суммы в итоговый risk score при превышении порога профиля клиента.",
      kk: "Сома клиент профилінен асқан кезде жалпы тәуекел балына қосылатын салмақ.",
      en: "Risk points contributed when transaction amount exceeds the customer's scaled baseline.",
    },
    higherEffect: {
      ru: "Повышение веса увеличивает итоговый балл риска при резких скачках суммы перевода.",
      kk: "Салмақты көтеру сома күрт өскенде жалпы тәуекел балын арттырады.",
      en: "Higher weight amplifies score contribution during large amount deviations.",
    },
    lowerEffect: {
      ru: "Снижение веса ослабляет влияние единичного всплеска суммы без других факторов.",
      kk: "Салмақты түсіру қосымша факторсыз сома ауытқуының әсерін азайтады.",
      en: "Lower weight reduces blocking from amount spikes alone.",
    },
    sideEffect: {
      ru: "Может приводить к ложным блокировкам при разовых крупных платежах (недвижимость, авто, техника).",
      kk: "Бір реттік ірі заңды төлемдерде жалған бұғаттау тудыруы мүмкін.",
      en: "May falsely flag legitimate one-off large purchases.",
    },
  },
  velocity_window_min: {
    mechanism: "suspicious_sequence",
    humanName: {
      ru: "Окно анализа частоты операций (мин)",
      kk: "Операция жиілігін талдау терезесі (мин)",
      en: "Velocity analysis window (min)",
    },
    purpose: {
      ru: "Временной интервал, в течение которого подсчитывается количество последовательных операций клиента.",
      kk: "Клиенттің қатар жасалған операциялар саны есептелетін уақыт аралығы.",
      en: "Rolling time window over which sequential client transaction frequency is counted.",
    },
    higherEffect: {
      ru: "Расширение окна позволяет выявлять растянутые во времени серии дробления и атак.",
      kk: "Терезені кеңейту уақыт бойынша созылған күдікті серияларды анықтауға көмектеседі.",
      en: "Expanding the window captures slower multi-step transaction bursts.",
    },
    lowerEffect: {
      ru: "Сужение окна фокусирует правило только на мгновенных всплесках активности.",
      kk: "Терезені тарылту тек жылдам операциялар легін бақылайды.",
      en: "Narrowing the window limits detection to rapid bursts only.",
    },
    sideEffect: {
      ru: "При длинном окне обычная серия из нескольких бытовых платежей подряд чаще засчитывается как velocity.",
      kk: "Ұзақ терезеде қатар жасалған бірнеше заңды төлем жиірек серия ретінде белгіленуі мүмкін.",
      en: "Longer windows increase false velocity flags on normal clusters of everyday payments.",
    },
  },
  velocity_min_tx: {
    mechanism: "suspicious_sequence",
    humanName: {
      ru: "Минимум операций для сигнала частоты",
      kk: "Жиілік дабылы үшін ең аз операция саны",
      en: "Minimum transactions for velocity alert",
    },
    purpose: {
      ru: "Минимальное число переводов в окне velocity, при котором активируется правило подозрительной серии.",
      kk: "Күдікті серия ережесі іске қосылатын терезедегі ең аз аударым саны.",
      en: "Minimum number of transactions inside the window required to trigger velocity scoring.",
    },
    higherEffect: {
      ru: "Увеличение минимума делает правило более сдержанным (требует длинную серию операций).",
      kk: "Ең аз санды арттыру ережені сақтықпен іске қосады (ұзағырақ серия қажет).",
      en: "Raising the minimum makes the rule stricter by requiring longer sequences.",
    },
    lowerEffect: {
      ru: "Снижение минимума делает детектор чувствительнее: короткие серии (например, от 3 операций) сразу фиксируются.",
      kk: "Ең аз санды төмендету детекторды сезімтал етеді: қысқа сериялар ертерек анықталады.",
      en: "Lowering the minimum increases sensitivity by flagging shorter bursts (e.g., 3+ tx).",
    },
    sideEffect: {
      ru: "Обычные пользователи, совершающие 3 платежа подряд (связь, переводы, маркетплейс), рискуют получить FP.",
      kk: "Қатар 3 заңды төлем жасаған клиенттерде жалған бұғаттау қаупі өседі.",
      en: "Normal users paying 3 bills or merchants in a row risk false positives.",
    },
  },
  velocity_weight: {
    mechanism: "suspicious_sequence",
    humanName: {
      ru: "Вес правила частоты операций",
      kk: "Операция жиілігі ережесінің салмағы",
      en: "Velocity rule weight",
    },
    purpose: {
      ru: "Вклад срабатывания правила подозрительной последовательности в общий балл риска.",
      kk: "Күдікті операциялар сериясы ережесінің жалпы тәуекел балына қосатын салмағы.",
      en: "Score points added when sequential transaction velocity exceeds the configured minimum.",
    },
    higherEffect: {
      ru: "Повышение веса усиливает значимость частых серий в итоговой блокировке.",
      kk: "Салмақты көтеру жиі сериялардың бұғаттауға әсерін күшейтеді.",
      en: "Higher weight amplifies velocity impact on the final risk decision.",
    },
    lowerEffect: {
      ru: "Снижение веса уменьшает влияние частоты операций при отсутствии других признаков.",
      kk: "Салмақты түсіру басқа белгілерсіз жиіліктің әсерін төмендетеді.",
      en: "Lower weight reduces reliance on transaction count alone.",
    },
    sideEffect: {
      ru: "Может приводить к ложным блокировкам в часы высокой клиентской активности.",
      kk: "Белсенді төлем кезеңдерінде жалған дабылдар жиілеуі мүмкін.",
      en: "Can raise false blocks during peak legitimate shopping hours.",
    },
  },
  decision_threshold: {
    mechanism: "decision_threshold",
    humanName: {
      ru: "Общий порог принятия решения",
      kk: "Шешім қабылдаудың жалпы шегі",
      en: "Global decision threshold",
    },
    purpose: {
      ru: "Глобальная граница итогового risk score (0–100), при достижении которой операция блокируется.",
      kk: "Операция бұғатталатын жалпы тәуекел балының (0–100) жаһандық шегі.",
      en: "Global score cutoff (0–100) above which any transaction is flagged as risky.",
    },
    higherEffect: {
      ru: "Повышение порога снижает число ложных тревог, но уменьшает чувствительность к пограничным атакам.",
      kk: "Шекті көтеру жалған дабылдарды азайтады, бірақ шекаралық шабуылдарды өткізу қаупін арттырады.",
      en: "Raising threshold reduces false blocks at the cost of missing borderline threats.",
    },
    lowerEffect: {
      ru: "Снижение порога переводит больше пограничных операций в блокировку по всем сценариям сразу.",
      kk: "Шекті төмендету барлық сценарий бойынша шекаралық операцияларды бұғаттауға ауыстырады.",
      en: "Lowering threshold flags more borderline multi-factor operations across all scenarios.",
    },
    sideEffect: {
      ru: "Системный сдвиг: влияет на все типы сценариев и чаще других правок вызывает рост ложных блокировок (FPR).",
      kk: "Жүйелік ығысу: барлық сценарийлерге әсер етіп, FPR өсуіне жиі себеп болады.",
      en: "Global cutoff shift affects all scenarios and is the primary driver of higher FPR.",
    },
  },
  threshold: {
    mechanism: "unusual_amount",
    humanName: {
      ru: "Порог срабатывания правила",
      kk: "Ереженің іске қосылу шегі",
      en: "Rule trigger threshold",
    },
    purpose: {
      ru: "Минимальное значение признака, при котором правило добавляет свой риск-балл.",
      kk: "Ереже тәуекел балын қосатын белгінің ең төменгі мәні.",
      en: "Minimum signal level required for this rule to activate.",
    },
    higherEffect: {
      ru: "Повышение порога сужает число срабатываний правила (меньше FP, выше риск FN).",
      kk: "Шекті көтеру ереже қосылуын сиретеді (FP аз, FN тәуекелі жоғары).",
      en: "Raising threshold narrows rule activation (fewer FPs, higher miss risk).",
    },
    lowerEffect: {
      ru: "Снижение порога делает правило более чувствительным к слабым сигналам.",
      kk: "Шекті түсіру ережені әлсіз белгілерге сезімтал етеді.",
      en: "Lowering threshold makes the rule trigger earlier on milder signals.",
    },
    sideEffect: {
      ru: "Слишком низкий порог расширяет ложные срабатывания на пограничных обычных операциях.",
      kk: "Тым төмен шек қалыпты операцияларда жалған дабылды көбейтеді.",
      en: "An overly low threshold increases false positives on borderline normal traffic.",
    },
  },
  weight: {
    mechanism: "unusual_amount",
    humanName: {
      ru: "Вес правила в скоринге",
      kk: "Скорингтегі ереже салмағы",
      en: "Rule score weight",
    },
    purpose: {
      ru: "Максимальный вклад данного правила в итоговый риск-балл транзакции.",
      kk: "Осы ереженің операцияның жалпы тәуекел балына қосатын ең жоғарғы үлесі.",
      en: "Score points contributed to total risk score when this rule fires.",
    },
    higherEffect: {
      ru: "Повышение веса усиливает значимость данного правила относительно порога блокировки.",
      kk: "Салмақты көтеру осы ереженің бұғаттау шегіне қатысты маңызын арттырады.",
      en: "Higher weight amplifies this rule's influence toward the block decision.",
    },
    lowerEffect: {
      ru: "Снижение веса уменьшает вероятность блокировки только по этому правилу.",
      kk: "Салмақты азайту тек осы ереже бойынша бұғаттау ықтималдығын төмендетеді.",
      en: "Lower weight dampens standalone impact of this rule.",
    },
    sideEffect: {
      ru: "Чрезмерный вес одного правила может вызывать блокировки без подтверждения другими признаками.",
      kk: "Бір ереженің тым үлкен салмағы қосымша белгісіз бұғаттау тудыруы мүмкін.",
      en: "Excess weight can trigger false blocks without corroborating signals.",
    },
  },
  window_minutes: {
    mechanism: "suspicious_sequence",
    humanName: {
      ru: "Временное окно правила (мин)",
      kk: "Ереженің уақыт терезесі (мин)",
      en: "Rule time window (min)",
    },
    purpose: {
      ru: "Интервал времени для сопоставления предшествующих операций клиента.",
      kk: "Клиенттің алдыңғы операцияларын салыстыру уақыт аралығы.",
      en: "Lookback interval in minutes for matching prior client activity.",
    },
    higherEffect: {
      ru: "Увеличение окна объединяет события на более длинном интервале времени.",
      kk: "Терезені кеңейту ұзағырақ уақыттағы оқиғаларды біріктіреді.",
      en: "Longer window groups events spaced further apart.",
    },
    lowerEffect: {
      ru: "Сокращение окна учитывает только недавние операции.",
      kk: "Терезені қысқарту тек жақын уақыттағы операцияларды ескереді.",
      en: "Shorter window restricts lookback to recent events.",
    },
    sideEffect: {
      ru: "Длинное окно может захватывать обычные регулярные платежи клиента.",
      kk: "Ұзақ терезе заңды тұрақты төлемдерді қамтуы мүмкін.",
      en: "Wider windows risk matching legitimate routine transfers.",
    },
  },
  min_amount_kzt: {
    mechanism: "new_recipient_risk",
    humanName: {
      ru: "Минимальная сумма активации (KZT)",
      kk: "Іске қосылудың ең аз сомасы (KZT)",
      en: "Minimum activation amount (KZT)",
    },
    purpose: {
      ru: "Нижний порог суммы, с которого правило начинает начислять риск.",
      kk: "Ереже тәуекел балын қоса бастайтын ең төменгі сома шегі.",
      en: "Minimum transaction amount above which this rule becomes active.",
    },
    higherEffect: {
      ru: "Повышение минимума исключает мелкие переводы из проверки.",
      kk: "Минимумды көтеру ұсақ аударымдарды тексеруден босатады.",
      en: "Higher floor excludes small transfers from triggering.",
    },
    lowerEffect: {
      ru: "Снижение минимума включает в контроль переводы меньшего размера.",
      kk: "Минимумды түсіру кішігірім аударымдарды да бақылауға алады.",
      en: "Lower floor brings smaller transfers under scrutiny.",
    },
    sideEffect: {
      ru: "Слишком низкий порог повышает ложные срабатывания на повседневных небольших платежах.",
      kk: "Тым төмен шек күнделікті ұсақ төлемдерде жалған дабылды көбейтеді.",
      en: "Low floor increases false alerts on small everyday transfers.",
    },
  },
  context_amount_ratio: {
    mechanism: "unusual_amount",
    humanName: {
      ru: "Коэффициент превышения профиля суммы",
      kk: "Сома профилінен асу коэффициенті",
      en: "Context amount ratio",
    },
    purpose: {
      ru: "Во сколько раз текущая сумма должна превысить среднюю сумму клиента для срабатывания.",
      kk: "Ағымдағы сома клиенттің орташа сомасынан неше есе асуы тиіс коэффициенті.",
      en: "Multiple above the customer's baseline amount required to trigger.",
    },
    higherEffect: {
      ru: "Увеличение коэффициента смягчает проверку суммы.",
      kk: "Коэффициентті арттыру сома тексерісін жұмсартады.",
      en: "Higher ratio relaxes outlier detection.",
    },
    lowerEffect: {
      ru: "Снижение коэффициента делает проверку чувствительнее к скачкам суммы.",
      kk: "Коэффициентті төмендету сома ауытқуына сезімталдықты арттырады.",
      en: "Lower ratio triggers earlier on moderate amount spikes.",
    },
    sideEffect: {
      ru: "Узкий коэффициент чаще останавливает разовые крупные покупки клиента.",
      kk: "Тар коэффициент бір реттік ірі сатып алуларды жиі тоқтатуы мүмкін.",
      en: "Tighter ratio increases false blocks on occasional large purchases.",
    },
  },
  amount_tolerance_pct: {
    mechanism: "duplicate_payment",
    humanName: {
      ru: "Допуск совпадения суммы (%)",
      kk: "Сома сәйкестігінің ауытқу шегі (%)",
      en: "Amount match tolerance (%)",
    },
    purpose: {
      ru: "Допустимое отличие сумм при распознавании повторяющихся платежей.",
      kk: "Қайталанатын төлемдерді тану кезіндегі сома айырмашылығының рұқсат етілген шегі.",
      en: "Permitted amount variance for matching duplicate transfers.",
    },
    higherEffect: {
      ru: "Расширение допуска объединяет повторы с близкими суммами, но снижает точность отбора.",
      kk: "Шекті кеңейту сомасы жақын қайталауларды біріктіреді, бірақ дәлдікті азайтады.",
      en: "Raising tolerance catches modified-amount repeats while loosening match precision.",
    },
    lowerEffect: {
      ru: "Сужение допуска требует точного совпадения суммы.",
      kk: "Шекті тарылту соманың дәл сәйкестігін талап етеді.",
      en: "Lowering tolerance requires nearly exact amount matches.",
    },
    sideEffect: {
      ru: "Может приводить к ложному срабатыванию при двух похожих покупках в одном окне.",
      kk: "Бір терезедегі екі ұқсас сатып алуда жалған дабыл тудыруы мүмкін.",
      en: "Can falsely merge two similar legitimate payments.",
    },
  },
  structuring_window_min: {
    mechanism: "structuring_smurfing",
    humanName: {
      ru: "Окно контроля дробления (мин)",
      kk: "Бөлшектеуді бақылау терезесі (мин)",
      en: "Structuring detection window (min)",
    },
    purpose: {
      ru: "Интервал времени, в котором суммируются дробные переводы чуть ниже порога риска.",
      kk: "Қалыпты шектен сәл төмен бөлшектелген аударымдарды біріктіретін уақыт аралығы.",
      en: "Time window used to aggregate near-threshold split transfers into a structuring series.",
    },
    higherEffect: {
      ru: "Расширение окна связывает растянутые серии дробления (smurfing).",
      kk: "Терезені кеңейту уақытқа созылған бөлшектеу серияларын байланыстырады.",
      en: "Widening the window catches slower staggered structuring splits.",
    },
    lowerEffect: {
      ru: "Сужение окна учитывает только плотные серии мелких переводов.",
      kk: "Терезені тарылту тек тығыз ұсақ аударымдарды есептейді.",
      en: "Narrowing limits structuring checks to tighter transfer bursts.",
    },
    sideEffect: {
      ru: "При слишком широком окне несколько обычных ежедневных переводов могут складываться в серию.",
      kk: "Терезе тым кең болса, бірнеше қалыпты төлем серия болып көрінуі мүмкін.",
      en: "Very wide windows may group ordinary routine payments together.",
    },
  },
  structuring_min_tx: {
    mechanism: "structuring_smurfing",
    humanName: {
      ru: "Минимум переводов для серии дробления",
      kk: "Бөлшектеу сериясы үшін ең аз аударым саны",
      en: "Min transfers for structuring series",
    },
    purpose: {
      ru: "Минимальное число переводов в окне для фиксации дробления (smurfing).",
      kk: "Бөлшектеуді тіркеу үшін терезедегі ең аз аударымдар саны.",
      en: "Minimum count of sub-threshold transfers in the window to flag structuring.",
    },
    higherEffect: {
      ru: "Повышение порога требует более длинную серию переводов перед срабатыванием.",
      kk: "Шекті арттыру іске қосылу үшін ұзағырақ серияны талап еметін болады.",
      en: "Raising requires more split transfers before alerting.",
    },
    lowerEffect: {
      ru: "Снижение порога позволяет ловить дробление из 3 переводов.",
      kk: "Шекті төмендету 3 аударымнан тұратын бөлшектеуді ұстауға мүмкіндік береді.",
      en: "Lowering detects compact 3-transfer structuring splits.",
    },
    sideEffect: {
      ru: "Может реагировать на 3 последовательные бытовые покупки подряд.",
      kk: "Қатарынан жасалған 3 қалыпты сатып алуға реакция беруі мүмкін.",
      en: "Can alert on 3 routine consecutive retail payments.",
    },
  },
  structuring_weight: {
    mechanism: "structuring_smurfing",
    humanName: {
      ru: "Вес правила дробления (Smurfing)",
      kk: "Бөлшектеу ережесінің салмағы (Smurfing)",
      en: "Structuring rule weight",
    },
    purpose: {
      ru: "Вклад паттерна дробления крупной суммы в итоговый балл риска.",
      kk: "Ірі соманы бөлшектеу паттернінің жалпы тәуекел балына үлесі.",
      en: "Risk score points added when a structuring pattern matches.",
    },
    higherEffect: {
      ru: "Повышение веса приближает серию дробления к уверенному срабатыванию.",
      kk: "Салмақты арттыру бөлшектеу сериясын сенімді анықтауға жақындатады.",
      en: "Increasing weight helps push matched structuring splits over the risk cutoff.",
    },
    lowerEffect: {
      ru: "Снижение веса требует подтверждения другими факторами риска.",
      kk: "Салмақты азайту қосымша тәуекел факторларын талап етеді.",
      en: "Lowering weight requires secondary risk signals before alerting.",
    },
    sideEffect: {
      ru: "Избыточный вес усиливает риск ложного срабатывания при плотных мелких платежах.",
      kk: "Артық салмақ тығыз ұсақ төлемдерде жалған дабыл қаупін арттырады.",
      en: "High weight can elevate false positives on dense routine payouts.",
    },
  },
  ato_window_min: {
    mechanism: "account_takeover_ato",
    humanName: {
      ru: "Окно после смены устройства/гео (мин)",
      kk: "Құрылғы/гео ауысқаннан кейінгі терезе (мин)",
      en: "Post-device/geo shift lookback (min)",
    },
    purpose: {
      ru: "Окно времени после смены устройства или геолокации для контроля перевода новому получателю.",
      kk: "Құрылғы немесе геопозиция ауысқаннан кейін жаңа алушыға аударымды тексеру терезесі.",
      en: "Lookback minutes after a device or geo change when checking atypical new-recipient transfers.",
    },
    higherEffect: {
      ru: "Расширение окна ловит отложенный вывод средств после захвата сессии.",
      kk: "Терезені кеңейту сессияны басып алғаннан кейінгі кейінге қалдырылған шығаруды ұстайды.",
      en: "Widening lookback catches delayed ATO payouts after session takeover.",
    },
    lowerEffect: {
      ru: "Сужение окна проверяет только мгновенные переводы после смены входа.",
      kk: "Терезені тарылту тек кіргеннен кейінгі жедел аударымдарды тексереді.",
      en: "Narrowing inspects only immediate transfers after login context shifts.",
    },
    sideEffect: {
      ru: "Может чаще срабатывать при смене телефона или в поездках.",
      kk: "Телефон ауыстырғанда немесе сапарда жүргенде жиірек іске қосылуы мүмкін.",
      en: "May increase alerts when legitimate users travel or upgrade devices.",
    },
  },
  ato_weight: {
    mechanism: "account_takeover_ato",
    humanName: {
      ru: "Вес правила захвата аккаунта (ATO)",
      kk: "Аккаунтты басып алу ережесінің салмағы (ATO)",
      en: "Account Takeover (ATO) weight",
    },
    purpose: {
      ru: "Вклад комбинации «новое устройство/гео + новый получатель + нетипичная сумма» в risk score.",
      kk: "«Жаңа құрылғы/гео + жаңа алушы + әдеттен тыс сома» үйлесімінің тәуекел балына үлесі.",
      en: "Risk score points added when a device/geo shift aligns with an atypical new-payee payout.",
    },
    higherEffect: {
      ru: "Усиление веса ускоряет перехват подозрительного вывода после смены контекста.",
      kk: "Салмақты күшейту кіру контексті ауысқаннан кейінгі күдікті шығаруды тез ұстайды.",
      en: "Higher weight escalates suspicious payouts right after a device or geo switch.",
    },
    lowerEffect: {
      ru: "Снижение веса смягчает реакцию на смену устройства при небольших суммах.",
      kk: "Салмақты төмендету шағын сомаларда құрылғы ауысуына реакцияны жұмсартады.",
      en: "Lower weight softens reactions to new devices on smaller payouts.",
    },
    sideEffect: {
      ru: "Высокий вес способен блокировать крупную покупку с нового смартфона.",
      kk: "Жоғары салмақ жаңа смартфоннан ірі сатып алуды бұғаттауы мүмкін.",
      en: "Elevated weight risks stopping a legitimate high transfer from a newly activated device.",
    },
  },
  block_threshold: {
    mechanism: "black_box_routing",
    humanName: {
      ru: "Внешний порог блокировки (Risk Score)",
      kk: "Сыртқы бұғаттау шегі (Risk Score)",
      en: "External block cutoff (Risk Score)",
    },
    purpose: {
      ru: "Порог внешнего score (внутренние правила не меняются), выше которого операция уходит в Block.",
      kk: "Сыртқы score шегі (ішкі ережелер өзгермейді), одан жоғары операция Block аймағына түседі.",
      en: "External score cutoff routing operations to Block without altering hidden vendor rules.",
    },
    higherEffect: {
      ru: "Повышение порога снижает ложные блокировки, переводя пограничные случаи в Review или Allow.",
      kk: "Шекті көтеру жалған бұғаттауларды азайтып, шекаралық жағдайларды Review немесе Allow аймағына өткізеді.",
      en: "Raising cutoff lowers false blocks by shifting borderline ops into Review or Allow.",
    },
    lowerEffect: {
      ru: "Снижение внешнего порога перехватывает больше угроз без изменения правил вендора.",
      kk: "Сыртқы шекті төмендету вендор ережелерін өзгертпей көбірек қауіпті ұстайды.",
      en: "Lowering external cutoff captures more threats without touching vendor internals.",
    },
    sideEffect: {
      ru: "Регулирует только внешний порог отсечения; при низкой оценке скоринга может расти FPR.",
      kk: "Тек сыртқы шекті реттейді; скоринг төмен болса FPR өсуі мүмкін.",
      en: "Adjusts cutoff only; lowering too far increases false blocks across noisy legit traffic.",
    },
  },
  review_threshold: {
    mechanism: "black_box_routing",
    humanName: {
      ru: "Граница зоны проверки (Review)",
      kk: "Тексеру аймағының шегі (Review)",
      en: "Review routing cutoff (Allow / Review)",
    },
    purpose: {
      ru: "Нижний порог для направления пограничных операций на ручную проверку вместо автоматического Allow.",
      kk: "Шекаралық операцияларды автоматты Allow орнына қолмен тексеруге жіберудің төменгі шегі.",
      en: "Lower risk-score boundary sending borderline operations to manual Review instead of direct Allow.",
    },
    higherEffect: {
      ru: "Повышение границы разгружает очередь Review, пропуская больше операций в Allow.",
      kk: "Шекті көтеру Review кезегін азайтып, көбірек операцияны Allow аймағына жібереді.",
      en: "Raising sends more borderline operations directly to Allow and shrinks the Review queue.",
    },
    lowerEffect: {
      ru: "Снижение границы направляет больше пограничных переводов на дополнительную проверку.",
      kk: "Шекті төмендету көбірек шекаралық аударымдарды қосымша тексеруге бағыттайды.",
      en: "Lowering routes more borderline transfers into manual Review without instant blocking.",
    },
    sideEffect: {
      ru: "Увеличивает долю операций в очереди аналитиков (Review queue).",
      kk: "Талдаушылар кезегіндегі (Review queue) операциялар үлесін арттырады.",
      en: "Increases the share of operations queued for manual Review.",
    },
  },
};

const RULE_TO_MECHANISM: Record<string, DefenseMechanismKey> = {
  duplicate_payment: "duplicate_payment",
  new_recipient_risk: "new_recipient_risk",
  unusual_amount: "unusual_amount",
  unusual_frequency: "suspicious_sequence",
  suspicious_sequence: "suspicious_sequence",
  structuring_smurfing: "structuring_smurfing",
  account_takeover_ato: "account_takeover_ato",
  black_box_routing: "black_box_routing",
  decision_threshold: "decision_threshold",
};

export interface LocalizedParamExplain {
  humanName: string;
  mechanism: DefenseMechanismKey;
  purpose: string;
  hypothesis: string;
  sideEffect: string;
}

export function getParamSemanticExplanation(
  param: string,
  ruleKey: string,
  oldValue: unknown,
  newValue: unknown,
  lang: Language,
  backendFallback?: {
    mechanism?: string;
    purpose?: string;
    expectedEffect?: string;
    sideEffect?: string;
  }
): LocalizedParamExplain {
  const spec = PARAM_CATALOG[param];
  const fallbackMech =
    (backendFallback?.mechanism as DefenseMechanismKey) ||
    RULE_TO_MECHANISM[ruleKey] ||
    "decision_threshold";

  if (!spec) {
    return {
      humanName: param,
      mechanism: fallbackMech,
      purpose: backendFallback?.purpose || param,
      hypothesis: backendFallback?.expectedEffect || "",
      sideEffect: backendFallback?.sideEffect || "",
    };
  }

  let hypothesis = spec.lowerEffect[lang];
  if (typeof oldValue === "number" && typeof newValue === "number") {
    hypothesis = newValue >= oldValue ? spec.higherEffect[lang] : spec.lowerEffect[lang];
  } else if (typeof oldValue === "boolean" && typeof newValue === "boolean") {
    hypothesis = newValue
      ? spec.higherEffect[lang]
      : spec.lowerEffect[lang];
  }

  const mech =
    spec.mechanism !== "unusual_amount" && spec.mechanism !== "suspicious_sequence"
      ? spec.mechanism
      : RULE_TO_MECHANISM[ruleKey] || spec.mechanism;

  return {
    humanName: spec.humanName[lang],
    mechanism: mech,
    purpose: spec.purpose[lang],
    hypothesis,
    sideEffect: spec.sideEffect[lang],
  };
}
