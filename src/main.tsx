import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  centers,
  createGroups,
  bulkMoveBlockers,
  ineligibleReason,
  isProblematic,
  matchesSearch,
  setReplicaEnabled,
  switchMaster,
} from "./model";
import type { DataCenter, Group, Instance, Scenario } from "./model";
import "./styles.css";

type Operation = {
  kind: "switchover";
  id: number;
  time: string;
  group: string;
  source: Instance;
  target: Instance;
  status: "running" | "success" | "error";
  stage: number;
  reason?: string;
};
type SimpleEvent = {
  kind: "bulk" | "replica";
  id: number;
  time: string;
  group: string;
  description: string;
  status: "running" | "success";
  stage?: number;
};
type HistoryEntry = Operation | SimpleEvent;
type BulkProgress = { id: number; source: DataCenter; destination: DataCenter; groupIds: string[]; completed: number; stage: "check" | "moving" | "done"; step: number };
type ReplicaProgress = { id: number; group: string; instanceId: number; instanceDc: DataCenter; enabled: boolean; stage: number; status: "running" | "success" };
const statuses = {
  running: "Выполняется",
  success: "Успешно",
  error: "Ошибка",
};
const stages = [
  "Проверка",
  "Отключение старого мастера",
  "Применение всех изменений репликации",
  "Включение нового мастера",
  "Завершение",
];
const replicaStages = ["Предварительная проверка", "Публикация карты распределения", "Проверка после изменения"];
const randomStepDuration = () => 3000 + Math.floor(Math.random() * 4001);
function stageOffsets(count: number): number[] {
  const offsets = [0];
  for (let step = 0; step < count; step++) {
    offsets.push(offsets[step] + randomStepDuration());
  }
  return offsets;
}
const scenarios: { id: Scenario; label: string }[] = [
  { id: "healthy", label: "Всё исправно" },
  { id: "lag", label: "Реплика отстаёт" },
  { id: "unavailable", label: "Реплика недоступна" },
];

function Icon({
  name,
  size = 18,
}: {
  name: "search" | "close" | "reset" | "arrow" | "check" | "clock";
  size?: number;
}) {
  const paths = {
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    reset: (
      <>
        <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function Availability({ available }: { available: boolean }) {
  return (
    <span className={available ? "availability" : "availability unavailable"}>
      <span className="availability-symbol" aria-hidden="true">
        {available ? "✓" : "✕"}
      </span>
      {available ? "Доступен" : "Недоступен"}
    </span>
  );
}

function InstanceInfo({ instance }: { instance: Instance }) {
  return (
    <div
      className={`instance ${!instance.available ? "instance-offline" : ""}`}
    >
      <div className="instance-top">
        <span className="instance-id">№{instance.id}</span>
        <span className={`role ${instance.role}`}>
          {instance.role === "master" ? "Мастер" : "Реплика"}
        </span>
      </div>
      <div className="instance-meta">
        <Availability available={instance.available} />
        {instance.role === "replica" && instance.available && (
          instance.replicationEnabled ? (
            <span className={instance.lag > 1000 ? "lag lag-warning" : "lag"}>
              <span>Отставание: </span>{instance.lag} мс
            </span>
          ) : <span className="replication-disabled">Репликация отключена</span>
        )}
      </div>
    </div>
  );
}

function GroupStatus({ group }: { group: Group }) {
  const offline = group.instances.some((instance) => !instance.available);
  const lagging = group.instances.some(
    (instance) => instance.role === "replica" && instance.replicationEnabled && instance.lag > 1000,
  );
  return (
    <div className="group-status">
      {offline && (
        <span className="status-badge error">
          <span aria-hidden="true">!</span> Недоступен
        </span>
      )}
      {lagging && (
        <span className="status-badge warning">
          <span aria-hidden="true">!</span> Отставание
        </span>
      )}
      {!offline && !lagging && (
        <span className="healthy-status">
          <Icon name="check" size={15} />
          Всё исправно
        </span>
      )}
    </div>
  );
}

function StageList({ labels, step, status = "running" }: { labels: string[]; step: number; status?: "running" | "success" | "error" }) {
  return <ol className="stages">
    {labels.map((label, index) => {
      const completed = status === "success" || index < step;
      const failed = status === "error" && index === step;
      const current = status === "running" && index === step;
      return <li key={label} className={completed ? "completed" : failed ? "failed" : current ? "current" : ""}>
        <span className="stage-marker">
          {completed ? <Icon name="check" size={14} /> : failed ? "!" : current ? <span className="spinner" /> : index + 1}
        </span>
        <span>{label}</span>
        <small>{completed ? "Готово" : failed ? "Ошибка" : current ? "Выполняется" : status === "error" ? "Не выполнено" : "Ожидание"}</small>
      </li>;
    })}
  </ol>;
}

function App() {
  const [groups, setGroups] = useState(() => createGroups());
  const [scenario, setScenario] = useState<Scenario>("healthy");
  const [search, setSearch] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [destination, setDestination] = useState<DataCenter>("A");
  const [source, setSource] = useState<DataCenter>("B");
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  const [replicaProgress, setReplicaProgress] = useState<ReplicaProgress | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const sequence = useRef(0);
  const busy = operation?.status === "running" || (bulkProgress !== null && bulkProgress.stage !== "done") || replicaProgress?.status === "running";
  const group = groups.find((item) => item.id === selectedGroup);
  const master = group?.instances.find(
    (instance) => instance.role === "master",
  );
  const target = group?.instances.find((instance) => instance.id === targetId);
  const shownOperation = operation?.group === selectedGroup ? operation : null;
  const shownReplicaOperation = replicaProgress?.group === selectedGroup ? replicaProgress : null;
  const visibleGroups = groups.filter(
    (item) =>
      matchesSearch(item, search) && (!onlyProblems || isProblematic(item)),
  );
  const problemCount = groups.filter(isProblematic).length;
  const offlineCount = groups
    .flatMap((item) => item.instances)
    .filter((instance) => !instance.available).length;
  const bulkBlockers = bulkMoveBlockers(groups, source, destination);
  const groupsToMove = groups.filter((item) =>
    item.instances.some((instance) => instance.dc === source && instance.role === "master"),
  );

  useEffect(() => {
    if (selectedGroup && !dialog.current?.open) dialog.current?.showModal();
    if (!selectedGroup && dialog.current?.open) dialog.current?.close();
  }, [selectedGroup]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function openGroup(id: string) {
    setSelectedGroup(id);
    setChoosing(false);
    setTargetId(null);
  }
  function closePanel() {
    setSelectedGroup(null);
    setChoosing(false);
    setTargetId(null);
  }
  function loadScenario(next: Scenario, reset = false) {
    if (locked.current) return;
    setScenario(next);
    setGroups(createGroups(next));
    setHistory([]);
    setOperation(null);
    setBulkProgress(null);
    setReplicaProgress(null);
    closePanel();
    if (reset) {
      setSearch("");
      setOnlyProblems(false);
      setFailNext(false);
      setDestination("A");
      setSource("B");
    }
    setNotice(
      reset
        ? "Демо сброшено. Восстановлено исходное состояние."
        : `Загружен сценарий «${scenarios.find((item) => item.id === next)?.label}». История очищена.`,
    );
  }
  function updateOperation(next: Operation) {
    setOperation(next);
    setHistory((items) =>
      items.map((item) => (item.id === next.id ? next : item)),
    );
  }
  function toggleReplica(instance: Instance) {
    if (locked.current || !group || group.mode !== "asynchronous" || instance.role !== "replica") return;
    locked.current = true;
    const enabled = !instance.replicationEnabled;
    const started: ReplicaProgress = { id: ++sequence.current, group: group.id, instanceId: instance.id, instanceDc: instance.dc, enabled, stage: 0, status: "running" };
    setOperation(null);
    setChoosing(false);
    setTargetId(null);
    setReplicaProgress(started);
    const event: SimpleEvent = {
      kind: "replica", id: started.id,
      time: new Date().toLocaleTimeString("ru-RU"), group: group.id,
      description: `Репликация №${instance.id} в ЦОД ${instance.dc}: ${enabled ? "включение" : "отключение"}`,
      status: "running", stage: 0,
    };
    setHistory((items) => [event, ...items]);
    setNotice(`${group.id}: начата симуляция ${enabled ? "включения" : "отключения"} репликации №${instance.id}.`);
    const offsets = stageOffsets(replicaStages.length);
    timers.current = [
      setTimeout(() => {
        setReplicaProgress({ ...started, stage: 1 });
        setHistory((items) => items.map((item) => item.id === started.id ? { ...event, stage: 1 } : item));
      }, offsets[1]),
      setTimeout(() => {
        setGroups((items) => setReplicaEnabled(items, started.group, started.instanceId, enabled));
        setReplicaProgress({ ...started, stage: 2 });
        setHistory((items) => items.map((item) => item.id === started.id ? { ...event, stage: 2 } : item));
      }, offsets[2]),
      setTimeout(() => {
        setReplicaProgress({ ...started, stage: replicaStages.length, status: "success" });
        setHistory((items) => items.map((item) => item.id === started.id ? { ...event, status: "success", stage: replicaStages.length,
          description: `Репликация №${instance.id} в ЦОД ${instance.dc}: ${enabled ? "включена" : "отключена"}` } : item));
        locked.current = false;
        setNotice(`${group.id}: репликация №${instance.id} ${enabled ? "включена" : "отключена"}.`);
      }, offsets[3]),
    ];
  }
  function moveAll() {
    if (locked.current || bulkBlockers.length || !groupsToMove.length) return;
    locked.current = true;
    const started: BulkProgress = {
      id: ++sequence.current, source, destination,
      groupIds: groupsToMove.map((item) => item.id), completed: 0, stage: "check", step: 0,
    };
    setBulkProgress(started);
    const event: SimpleEvent = {
      kind: "bulk", id: started.id,
      time: new Date().toLocaleTimeString("ru-RU"), group: "Все группы",
      description: `ЦОД ${source} → ЦОД ${destination}: 0 из ${started.groupIds.length} групп`,
      status: "running",
    };
    setHistory((items) => [event, ...items]);
    setNotice(`Проверка ${started.groupIds.length} групп перед перемещением из ЦОД ${source} в ЦОД ${destination}.`);
    let groupStart = randomStepDuration();
    timers.current = started.groupIds.flatMap((groupId, index) => {
      const offsets = stageOffsets(stages.length);
      const groupTimers = offsets.map((offset, step) => setTimeout(() => {
        if (step < stages.length) {
          setBulkProgress({ ...started, completed: index, stage: "moving", step });
          return;
        }
        setGroups((items) => {
          const currentGroup = items.find((item) => item.id === groupId);
          const target = currentGroup?.instances.find((item) => item.dc === destination);
          return target ? switchMaster(items, groupId, target.id) : items;
        });
        const completed = index + 1;
        const done = completed === started.groupIds.length;
        setBulkProgress({ ...started, completed, stage: done ? "done" : "moving", step: done ? stages.length : 0 });
        setHistory((items) => items.map((item) => item.id === started.id ? {
          ...event, description: `ЦОД ${source} → ЦОД ${destination}: ${completed} из ${started.groupIds.length} групп`,
          status: done ? "success" : "running",
        } : item));
        if (done) {
          locked.current = false;
          setNotice(`Перемещены мастера ${started.groupIds.length} групп из ЦОД ${source} в ЦОД ${destination}.`);
        }
      }, groupStart + offset));
      groupStart += offsets[stages.length];
      return groupTimers;
    });
  }
  function startOperation() {
    if (
      locked.current ||
      !group ||
      !master?.available ||
      !target ||
      target.role !== "replica" ||
      ineligibleReason(target)
    )
      return;
    locked.current = true;
    const shouldFail = failNext;
    setFailNext(false);
    setChoosing(false);
    setReplicaProgress(null);
    const started: Operation = {
      kind: "switchover",
      id: ++sequence.current,
      time: new Date().toLocaleTimeString("ru-RU"),
      group: group.id,
      source: { ...master },
      target: { ...target },
      status: "running",
      stage: 0,
    };
    setOperation(started);
    setHistory((items) => [started, ...items]);
    setNotice(`Начата симуляция переключения ${group.id}.`);
    const offsets = stageOffsets(stages.length);
    timers.current = [];
    if (shouldFail) {
      timers.current.push(
        setTimeout(() => {
          updateOperation({
            ...started,
            status: "error",
            reason:
              "Симулированная ошибка предварительной проверки. Роли экземпляров не изменены.",
          });
          locked.current = false;
          setNotice(
            `Ошибка переключения ${started.group}: симулированный сбой проверки. Роли не изменены.`,
          );
        }, offsets[1]),
      );
      return;
    }
    timers.current.push(...offsets.slice(1, -1).map((offset, index) =>
      setTimeout(() => updateOperation({ ...started, stage: index + 1 }), offset),
    ));
    timers.current.push(
      setTimeout(() => {
        setGroups((items) =>
          switchMaster(items, started.group, started.target.id),
        );
        updateOperation({ ...started, stage: stages.length, status: "success" });
        locked.current = false;
        setTargetId(null);
        setNotice(
          `${started.group}: мастер переключён на №${started.target.id} в ЦОД ${started.target.dc}.`,
        );
      }, offsets[stages.length]),
    );
  }

  return (
    <main className="app-shell">
      <section className="demo-section" aria-labelledby="demo-title">
        <div className="demo-controls">
          <h2 id="demo-title">Управление демо</h2>
          <div
            className="scenario-buttons"
            role="group"
            aria-label="Выбрать демо-сценарий"
          >
            {scenarios.map((item) => (
              <button
                key={item.id}
                className={`scenario-button ${scenario === item.id ? "active" : ""}`}
                aria-pressed={scenario === item.id}
                onClick={() => loadScenario(item.id)}
                disabled={busy}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="failure-toggle">
            <input
              type="checkbox"
              checked={failNext}
              onChange={(event) => setFailNext(event.target.checked)}
              disabled={busy}
            />
            <span>
              Следующее одиночное переключение
              <br className="wide-break" /> завершится ошибкой
            </span>
          </label>
          <button
            className="button secondary reset-button"
            onClick={() => loadScenario("healthy", true)}
            disabled={busy}
            title={busy ? "Дождитесь завершения операции" : undefined}
          >
            <Icon name="reset" />
            Сбросить демо
          </button>
        </div>
        <div className="demo-hint">
          <span>
            {busy
              ? "Выполняется симуляция. Сценарии, повторное переключение и сброс доступны после завершения."
              : "Сценарии загружают исходные данные и очищают историю. Проблемы показаны в G01."}
          </span>
          <button className="text-button" onClick={() => openGroup("G01")}>
            Открыть G01 <Icon name="arrow" size={15} />
          </button>
        </div>
      </section>
      <hr className="demo-divider" />
      <header className="page-header">
        <div>
          <div className="title-line">
            <h1>Управление шардами</h1>
            <span className="demo-badge">
              <i />
              Демонстрационный режим
            </span>
          </div>
        </div>
      </header>

      <section className="bulk-section" aria-labelledby="bulk-title">
        <div>
          <h2 id="bulk-title">Переместить мастера между ЦОД</h2>
          <p>Мастера групп из исходного ЦОД переходят в целевой. Перед началом проверяются все затронутые группы.</p>
        </div>
        <div className="bulk-controls">
          <label htmlFor="bulk-source">Из ЦОД</label>
          <select id="bulk-source" value={source} disabled={busy}
            onChange={(event) => { setSource(event.target.value as DataCenter); setBulkProgress(null); }}>
            {centers.map((dc) => <option key={dc} value={dc}>ЦОД {dc}</option>)}
          </select>
          <label htmlFor="bulk-destination">В ЦОД</label>
          <select id="bulk-destination" value={destination} disabled={busy}
            onChange={(event) => { setDestination(event.target.value as DataCenter); setBulkProgress(null); }}>
            {centers.map((dc) => <option key={dc} value={dc}>ЦОД {dc}</option>)}
          </select>
          <button className="button primary" disabled={busy || bulkBlockers.length > 0 || groupsToMove.length === 0}
            onClick={moveAll}>Переместить мастера</button>
        </div>
        <p className={bulkBlockers.length ? "bulk-feedback inline-error" : "bulk-feedback"}>
          {bulkBlockers.length
            ? `Перемещение недоступно: ${bulkBlockers.join("; ")}.`
            : groupsToMove.length === 0
              ? `В ЦОД ${source} сейчас нет мастеров.`
              : `${groupsToMove.length} групп будут переключены из ЦОД ${source} в ЦОД ${destination}.`}
        </p>
        {bulkProgress && <div className="bulk-progress" role="status" aria-live="polite">
          <strong>{bulkProgress.stage === "check" ? "Проверка всех целевых реплик" :
            bulkProgress.stage === "done" ? "Перемещение завершено" :
              `${bulkProgress.groupIds[bulkProgress.completed]}: ${bulkProgress.completed} из ${bulkProgress.groupIds.length} групп перемещено`}</strong>
          <ol className="bulk-group-list">
            {bulkProgress.groupIds.map((id, index) => <li key={id} className={index < bulkProgress.completed ? "completed" : index === bulkProgress.completed && bulkProgress.stage === "moving" ? "current" : ""}>
              <span>{id}</span><span>{index < bulkProgress.completed ? "Готово" :
                index === bulkProgress.completed && bulkProgress.stage === "moving" ? stages[bulkProgress.step] : "Ожидание"}</span>
            </li>)}
          </ol>
          {bulkProgress.stage === "moving" && <div className="bulk-stage-details">
            <strong>Этапы переключения {bulkProgress.groupIds[bulkProgress.completed]}</strong>
            <StageList labels={stages} step={bulkProgress.step} />
          </div>}
        </div>}
      </section>

      <section className="summary" aria-label="Сводка по всей системе">
        <div
          className={`summary-item ${problemCount ? "summary-warning" : ""}`}
        >
          <span className="summary-label">Проблемные группы</span>
          <div>
            <strong>{problemCount}</strong>
            <span className="summary-context">из 12</span>
            <span
              className={`summary-dot ${problemCount ? "amber" : "neutral"}`}
            />
          </div>
        </div>
        <div className={`summary-item ${offlineCount ? "summary-error" : ""}`}>
          <span className="summary-label">Недоступные экземпляры</span>
          <div>
            <strong>{offlineCount}</strong>
            <span className="summary-context">из 36</span>
          </div>
        </div>
        {centers.map((dc) => (
          <div className="summary-item" key={dc}>
            <span className="summary-label">Мастера · ЦОД {dc}</span>
            <div>
              <strong>
                {
                  groups
                    .flatMap((item) => item.instances)
                    .filter(
                      (instance) =>
                        instance.role === "master" && instance.dc === dc,
                    ).length
                }
              </strong>
              <span className="summary-context">из 12</span>
            </div>
          </div>
        ))}
      </section>

      <section className="groups-section" aria-labelledby="groups-title">
        <div className="section-heading">
          <div className="section-title">
            <h2 id="groups-title">Репликационные группы</h2>
            <span className="count-badge">12</span>
          </div>
          <span className="section-description">
            36 экземпляров · 3 центра обработки данных
          </span>
        </div>
        <div className="table-card">
          <div className="table-toolbar">
            <div className="search-field">
              <Icon name="search" />
              <input
                aria-label="Поиск по группе или точному номеру экземпляра"
                placeholder="Поиск по группе или № экземпляра"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button
                  className="icon-button"
                  aria-label="Очистить поиск"
                  onClick={() => setSearch("")}
                >
                  <Icon name="close" size={15} />
                </button>
              )}
            </div>
            <label className="problem-toggle">
              <input
                type="checkbox"
                checked={onlyProblems}
                onChange={(event) => setOnlyProblems(event.target.checked)}
              />
              <span className="switch" aria-hidden="true" />
              <span>Только проблемные</span>
            </label>
            <span className="result-count">
              Показано {visibleGroups.length} из 12
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Группа</th>
                  {centers.map((dc) => (
                    <th scope="col" key={dc}>
                      ЦОД {dc}
                    </th>
                  ))}
                  <th scope="col">Состояние</th>
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => openGroup(item.id)}
                    className={isProblematic(item) ? "problem-row" : ""}
                  >
                    <th scope="row">
                      <button
                        className="group-link"
                        onClick={(event) => {
                          event.stopPropagation();
                          openGroup(item.id);
                        }}
                        aria-label={`Открыть группу ${item.id}`}
                      >
                        {item.id}
                        <span aria-hidden="true">›</span>
                      </button>
                      <small className="group-mode">{item.mode === "asynchronous" ? "Асинхронный" : "Синхронный"}</small>
                    </th>
                    {item.instances.map((instance) => (
                      <td
                        key={instance.id}
                        className={
                          !instance.available ? "unavailable-cell" : undefined
                        }
                      >
                        <InstanceInfo instance={instance} />
                      </td>
                    ))}
                    <td>
                      <GroupStatus group={item} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visibleGroups.length && (
            <div className="empty-results">
              <Icon name="search" size={25} />
              <h3>Группы не найдены</h3>
              <p>Измените запрос или отключите фильтр проблемных групп.</p>
              <button
                className="button secondary"
                onClick={() => {
                  setSearch("");
                  setOnlyProblems(false);
                }}
              >
                Очистить поиск и фильтр
              </button>
            </div>
          )}
          <div className="table-footnote">
            <span>
              Выберите группу, чтобы посмотреть экземпляры и переключить мастер.
            </span>
            <span>Порог отставания в демо: 1000 мс</span>
          </div>
        </div>
      </section>

      <section className="history-section" aria-labelledby="history-title">
        <div className="section-heading">
          <div className="section-title">
            <h2 id="history-title">История операций</h2>
            <span className="count-badge">{history.length}</span>
          </div>
          <span className="section-description">Текущая сессия</span>
        </div>
        <div className="history-card">
          <div className="audit-scroll">
            <table className="audit-table" aria-labelledby="history-title">
              <colgroup>
                <col className="audit-time" />
                <col className="audit-group" />
                <col className="audit-transfer" />
                <col className="audit-result" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Время</th>
                  <th scope="col">Группа</th>
                  <th scope="col">Источник → цель</th>
                  <th scope="col">Результат</th>
                </tr>
              </thead>
              <tbody>
                {history.length ? (
                  history.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <time>{item.time}</time>
                      </td>
                      <th scope="row">{item.group}</th>
                      <td>
                        {item.kind === "switchover" ? (
                          <div className="history-route">
                            <span>№{item.source.id} · ЦОД {item.source.dc}</span>
                            <Icon name="arrow" size={16} />
                            <span>№{item.target.id} · ЦОД {item.target.dc}</span>
                          </div>
                        ) : <span>{item.description}{item.kind === "replica" && item.status === "running" && item.stage !== undefined
                          ? ` · ${replicaStages[item.stage]}` : ""}</span>}
                      </td>
                      <td>
                        <span className={`status-badge ${item.status}`}>
                          {item.status === "running" && (
                            <span className="spinner" />
                          )}
                          {statuses[item.status]}
                        </span>
                        {item.kind === "switchover" && item.reason && (
                          <p className="history-error">{item.reason}</p>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>
                      <div className="history-empty">
                        <Icon name="clock" size={22} />
                        <div>
                          <h3>Операций пока нет</h3>
                          <p>
                            Здесь появятся результаты переключений и изменений репликации.
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <footer className="page-footer">
        <span>
          Данные хранятся только в текущей сессии и сбрасываются при
          перезагрузке.
        </span>
        <span>Все операции — симуляция</span>
      </footer>
      <div className="sr-only" role="status" aria-live="polite">
        {notice}
      </div>

      <dialog
        ref={dialog}
        className="side-panel"
        aria-labelledby="panel-title"
        onCancel={(event) => {
          event.preventDefault();
          closePanel();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientX < rect.left) closePanel();
          }
        }}
      >
        {group && master && (
          <div className="panel-content">
            <header className="panel-header">
              <div>
                <span className="eyebrow">Репликационная группа</span>
                <h2 id="panel-title">{group.id}</h2>
                <span className="panel-mode">{group.mode === "asynchronous" ? "Асинхронный шард" : "Синхронный шард"}</span>
              </div>
              <button
                className="icon-button close-panel"
                onClick={closePanel}
                aria-label="Закрыть панель"
              >
                <Icon name="close" size={22} />
              </button>
            </header>
            <div className="panel-body">
              <div className="panel-state">
              <section className="workflow-step" aria-labelledby="state-title">
                <h3 className="step-heading" id="state-title">
                  <span className="step-number">1</span>Текущее состояние
                </h3>
                <GroupStatus group={group} />
                <div
                  className={`current-master ${!master.available ? "unavailable-cell" : ""}`}
                >
                  <span className="eyebrow">Текущий мастер</span>
                  <strong>
                    №{master.id} <span>·</span> ЦОД {master.dc}
                  </strong>
                  <Availability available={master.available} />
                </div>
                <h3 className="panel-section-title">Экземпляры группы</h3>
                <div className="panel-instances">
                  {group.instances.map((instance) => (
                    <div
                      className={`panel-instance ${!instance.available ? "unavailable-cell" : ""}`}
                      key={instance.id}
                    >
                      <span className="dc-label">ЦОД {instance.dc}</span>
                      <InstanceInfo instance={instance} />
                      {group.mode === "asynchronous" && instance.role === "replica" && (
                        <button className="button secondary replica-button"
                          disabled={busy}
                          onClick={() => toggleReplica(instance)}>
                          {instance.replicationEnabled ? "Отключить репликацию" : "Включить репликацию"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {group.mode === "asynchronous" && <p className="replica-hint">Отключённая реплика остаётся в группе, но не может стать мастером или целью перемещения.</p>}
              </section>
              </div>
              <div className="panel-actions">
                {!choosing && shownReplicaOperation && <section className="operation-section replica-operation" aria-live="polite">
                  <h3>{shownReplicaOperation.status === "running"
                    ? `${shownReplicaOperation.enabled ? "Включение" : "Отключение"} репликации`
                    : `Репликация ${shownReplicaOperation.enabled ? "включена" : "отключена"}`}</h3>
                  <p className="simulation-note">Симуляция операции · {shownReplicaOperation.group}</p>
                  <p className="operation-route">Реплика №{shownReplicaOperation.instanceId} · ЦОД {shownReplicaOperation.instanceDc}</p>
                  <StageList labels={replicaStages} step={shownReplicaOperation.stage} status={shownReplicaOperation.status} />
                  {shownReplicaOperation.status === "success" && <p className="success-box">
                    Репликация №{shownReplicaOperation.instanceId} {shownReplicaOperation.enabled ? "включена" : "отключена"}.
                  </p>}
                  {shownReplicaOperation.status === "running" ? <p className="muted">
                    Повторное изменение недоступно до завершения. Панель можно закрыть — операция продолжится.
                  </p> : <button className="button primary full-width" disabled={!master.available}
                    onClick={() => { setReplicaProgress(null); setChoosing(true); setTargetId(null); }}>
                    Переключить мастер
                  </button>}
                </section>}
              {!choosing && !shownOperation && !shownReplicaOperation && (
                <div className="action-section">
                  <h3>Плановое переключение</h3>
                  <p>
                    Выберите доступную реплику с отставанием не более 1000 мс.
                    Текущий мастер станет репликой.
                  </p>
                  <button
                    className="button primary full-width"
                    disabled={busy || !master.available}
                    onClick={() => {
                      setReplicaProgress(null);
                      setChoosing(true);
                      setTargetId(null);
                    }}
                  >
                    Переключить мастер <Icon name="arrow" size={17} />
                  </button>
                  {!master.available && (
                    <p className="inline-error">
                      Текущий мастер недоступен. Плановое переключение
                      невозможно.
                    </p>
                  )}
                  {busy && (
                    <p className="muted">
                      Дождитесь завершения текущей операции.
                    </p>
                  )}
                </div>
              )}

              {choosing && (
                <section className="switchover" aria-labelledby="switch-title">
                  <section
                    className="workflow-step"
                    aria-labelledby="switch-title"
                  >
                    <h3 className="step-heading" id="switch-title">
                      <span className="step-number">2</span>Выбор нового мастера
                    </h3>
                    <p className="muted">
                      Выберите реплику, которая станет новым мастером.
                    </p>
                    <fieldset className="target-options">
                      <legend className="sr-only">Новый мастер</legend>
                      {group.instances
                        .filter((instance) => instance.role === "replica")
                        .map((instance) => {
                          const reason = ineligibleReason(instance);
                          return (
                            <label
                              key={instance.id}
                              className={`target-option ${targetId === instance.id ? "selected" : ""} ${reason ? "disabled" : ""}`}
                            >
                              <input
                                type="radio"
                                name="target"
                                value={instance.id}
                                checked={targetId === instance.id}
                                disabled={Boolean(reason)}
                                onChange={() => setTargetId(instance.id)}
                              />
                              <span>
                                <strong>
                                  №{instance.id} · ЦОД {instance.dc}
                                </strong>
                                <small className={reason ? "inline-error" : ""}>
                                  {reason ||
                                    `Доступен · отставание ${instance.lag} мс`}
                                </small>
                              </span>
                            </label>
                          );
                        })}
                    </fieldset>
                  </section>
                  <section
                    className="readiness workflow-step"
                    aria-labelledby="readiness-title"
                  >
                    <h3 className="step-heading" id="readiness-title">
                      <span className="step-number">3</span>Проверка готовности
                    </h3>
                    <p
                      className={
                        master.available ? "check-pass" : "inline-error"
                      }
                    >
                      <span aria-hidden="true">
                        {master.available ? "✓" : "!"}
                      </span>
                      {master.available
                        ? "Текущий мастер доступен"
                        : "Текущий мастер недоступен"}
                    </p>
                    <p className={target ? "check-pass" : "muted"}>
                      <span aria-hidden="true">{target ? "✓" : "○"}</span>
                      {target
                        ? "Целевая реплика доступна"
                        : "Выберите целевую реплику"}
                    </p>
                    <p className={target ? "check-pass" : "muted"}>
                      <span aria-hidden="true">{target ? "✓" : "○"}</span>
                      {target
                        ? `Отставание ${target.lag} мс — не более 1000 мс`
                        : "Отставание будет проверено после выбора"}
                    </p>
                  </section>
                  <section
                    className="workflow-step confirmation-step"
                    aria-labelledby="confirmation-title"
                  >
                    <h3 className="step-heading" id="confirmation-title">
                      <span className="step-number">4</span>Подтверждение
                    </h3>
                    {target && (
                      <div className="confirmation-route">
                        <span className="eyebrow">Будет выполнено</span>
                        <p>
                          {group.id}: мастер №{master.id} в ЦОД {master.dc} → №
                          {target.id} в ЦОД {target.dc}
                        </p>
                      </div>
                    )}
                    <p className="simulation-note">
                      Это симуляция. Реальные базы данных не затрагиваются.
                    </p>
                    <button
                      className="button primary full-width"
                      disabled={!target || !master.available || busy}
                      onClick={startOperation}
                    >
                      Подтвердить переключение
                    </button>
                    {!target && (
                      <p className="control-hint">
                        Для подтверждения выберите доступную реплику.
                      </p>
                    )}
                    <button
                      className="button secondary full-width cancel-button"
                      onClick={() => {
                        setChoosing(false);
                        setTargetId(null);
                      }}
                    >
                      Отмена
                    </button>
                  </section>
                </section>
              )}

              {!choosing && shownOperation && (
                <section className="operation-section" aria-live="polite">
                  <h3>
                    {shownOperation.status === "running"
                      ? "Выполняется переключение"
                      : shownOperation.status === "success"
                        ? "Мастер переключён"
                        : "Переключение не выполнено"}
                  </h3>
                  <p className="simulation-note">
                    Симуляция операции · {shownOperation.group}
                  </p>
                  <p className="operation-route">
                    №{shownOperation.source.id} · ЦОД {shownOperation.source.dc}{" "}
                    → №{shownOperation.target.id} · ЦОД{" "}
                    {shownOperation.target.dc}
                  </p>
                  <StageList labels={stages} step={shownOperation.stage} status={shownOperation.status} />
                  {shownOperation.status === "error" && (
                    <p className="error-box" role="alert">
                      {shownOperation.reason}
                    </p>
                  )}
                  {shownOperation.status === "success" && (
                    <p className="success-box">
                      Новый мастер — №{shownOperation.target.id} в ЦОД{" "}
                      {shownOperation.target.dc}. Предыдущий мастер стал
                      репликой.
                    </p>
                  )}
                  {shownOperation.status === "running" ? (
                    <p className="muted">
                      Повторное переключение недоступно до завершения. Панель
                      можно закрыть — операция продолжится.
                    </p>
                  ) : (
                    <button
                      className="button primary full-width"
                      onClick={() => {
                        setOperation(null);
                        setChoosing(true);
                        setTargetId(null);
                      }}
                      disabled={busy || !master.available}
                    >
                      {shownOperation.status === "error"
                        ? "Повторить переключение"
                        : "Переключить мастер"}
                    </button>
                  )}
                </section>
              )}
              </div>
            </div>
            <footer className="panel-footer">
              <span className="demo-badge">
                <i />
                Демонстрационный режим
              </span>
            </footer>
          </div>
        )}
      </dialog>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
