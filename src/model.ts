export type DataCenter = "A" | "B" | "C";
export type Instance = {
  id: number;
  dc: DataCenter;
  role: "master" | "replica" | "offline-master" | "recovery";
  available: boolean;
  lag: number;
  replicationEnabled: boolean;
};
export type Group = { id: string; instances: Instance[] };
export type InstanceStatus = "MASTER_RW" | "MASTER_OFFLINE" | "RECOVERY" | "REPLICA_A" | "REPLICA_OFFLINE" | "MASTER_W" | "MASTER_R";
export type MasterTransfer = { sourceId: number; targetId: number; emergency?: boolean };
export type SwitchoverMode = "planned" | "emergency";

export function instanceStatus(instance: Instance, transfer: MasterTransfer | null = null): InstanceStatus {
  if (instance.id === transfer?.sourceId) return transfer.emergency ? "MASTER_OFFLINE" : "MASTER_R";
  if (instance.id === transfer?.targetId) return "MASTER_W";
  if (instance.role === "offline-master") return "MASTER_OFFLINE";
  if (instance.role === "recovery") return "RECOVERY";
  if (instance.role === "master") return "MASTER_RW";
  return instance.replicationEnabled ? "REPLICA_A" : "REPLICA_OFFLINE";
}

export function startRecovery(groups: Group[], groupId: string, instanceId: number): Group[] {
  return groups.map((group) => group.id === groupId ? {
    ...group,
    instances: group.instances.map((instance) => instance.id === instanceId && instance.role === "offline-master"
      ? { ...instance, role: "recovery", available: false, replicationEnabled: false }
      : instance),
  } : group);
}

export function completeRecovery(groups: Group[], groupId: string, instanceId: number): Group[] {
  return groups.map((group) => group.id === groupId ? {
    ...group,
    instances: group.instances.map((instance) => instance.id === instanceId && instance.role === "recovery"
      ? { ...instance, role: "replica", available: true, replicationEnabled: true, lag: 0 }
      : instance),
  } : group);
}

export type Scenario = "healthy" | "lag" | "unavailable";
export type ServiceMode = "mono" | "multi";
export const shardEgressPodCount = 372;
export const shardEgressNamespaceCount = 3;
export const serviceModes = {
  mono: { label: "Моно", emoji: "🎯" },
  multi: { label: "Мульти", emoji: "🌐" },
};
export const centers: DataCenter[] = ["A", "B", "C"];
export const lagLimit = 1000;

export function createGroups(scenario: Scenario = "healthy"): Group[] {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `G${String(index + 1).padStart(2, "0")}`,
    instances: centers.map((dc, offset) => ({
      id: index * 3 + offset + 1,
      dc,
      role: offset === index % 3 ? "master" : "replica",
      replicationEnabled: true,
      available: !(scenario === "unavailable" && index === 0 && offset === 1),
      lag:
        scenario === "lag" && index === 0 && offset === 1
          ? 8000
          : 24 + ((index * 17 + offset * 23) % 130),
    })),
  }));
}

export const isProblematic = (group: Group) =>
  group.instances.some(
    (instance) =>
      !instance.available ||
      (instance.role === "replica" && instance.replicationEnabled && instance.lag > lagLimit),
  );

export function ineligibleReason(instance: Instance, mode: SwitchoverMode = "planned"): string | null {
  if (instance.role !== "replica") return "Экземпляр не является репликой";
  if (!instance.available) return "Экземпляр недоступен";
  if (!instance.replicationEnabled) return "Репликация отключена";
  if (mode === "planned" && instance.lag > lagLimit)
    return `Отставание ${instance.lag} мс превышает 1000 мс`;
  return null;
}

export function setReplicaEnabled(
  groups: Group[], groupId: string, instanceId: number, enabled: boolean,
): Group[] {
  return groups.map((group) =>
    group.id === groupId
      ? {
          ...group,
          instances: group.instances.map((instance) =>
            instance.id === instanceId && instance.role === "replica"
              ? { ...instance, replicationEnabled: enabled }
              : instance,
          ),
        }
      : group,
  );
}

export type BulkDestinations = Partial<Record<string, DataCenter>>;

// Missing destinations keep the current master; only changed groups enter the queue.
export function distributionMoves(groups: Group[], destinations: BulkDestinations): Group[] {
  return groups.filter((group) => {
    const master = group.instances.find((instance) => instance.role === "master");
    return destinations[group.id] && destinations[group.id] !== master?.dc;
  });
}

export function distributionBlockers(groups: Group[], destinations: BulkDestinations): string[] {
  return distributionMoves(groups, destinations).flatMap((group) => {
    const master = group.instances.find((instance) => instance.role === "master");
    const target = group.instances.find((instance) => instance.dc === destinations[group.id]);
    if (!master?.available) return [`${group.id}: текущий мастер недоступен`];
    if (!target) return [`${group.id}: нет целевого экземпляра`];
    const reason = ineligibleReason(target);
    return reason ? [`${group.id}: ${reason.toLowerCase()}`] : [];
  });
}

export function matchesSearch(group: Group, query: string): boolean {
  const normalized = query.trim().toUpperCase();
  if (!normalized) return true;
  if (/^[#№]?\s*\d+$/.test(normalized)) {
    const id = Number(normalized.replace(/^[#№]\s*/, ""));
    return group.instances.some((instance) => instance.id === id);
  }
  return group.id.includes(normalized);
}

export function switchMaster(
  groups: Group[],
  groupId: string,
  targetId: number,
  mode: SwitchoverMode = "planned",
): Group[] {
  return groups.map((group) => {
    if (group.id !== groupId) return group;
    const master = group.instances.find(
      (instance) => instance.role === "master",
    );
    const target = group.instances.find((instance) => instance.id === targetId);
    if (
      !master ||
      (mode === "planned" && !master.available) ||
      !target ||
      target.role !== "replica" ||
      ineligibleReason(target, mode)
    )
      return group;
    return {
      ...group,
      instances: group.instances.map((instance) => {
        if (instance.id === targetId)
          return { ...instance, role: "master", lag: 0 };
        if (instance.role === "master")
          return mode === "emergency"
            ? { ...instance, role: "offline-master", available: false, replicationEnabled: false }
            : { ...instance, role: "replica", lag: 32 };
        return instance;
      }),
    };
  });
}
