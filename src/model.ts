export type DataCenter = "A" | "B" | "C";
export type Instance = {
  id: number;
  dc: DataCenter;
  role: "master" | "replica";
  available: boolean;
  lag: number;
};
export type Group = { id: string; instances: Instance[] };
export type Scenario = "healthy" | "lag" | "unavailable";
export const centers: DataCenter[] = ["A", "B", "C"];
export const lagLimit = 1000;

export function createGroups(scenario: Scenario = "healthy"): Group[] {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `G${String(index + 1).padStart(2, "0")}`,
    instances: centers.map((dc, offset) => ({
      id: index * 3 + offset + 1,
      dc,
      role: offset === index % 3 ? "master" : "replica",
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
      (instance.role === "replica" && instance.lag > lagLimit),
  );

export function ineligibleReason(instance: Instance): string | null {
  if (!instance.available) return "Экземпляр недоступен";
  if (instance.lag > lagLimit)
    return `Отставание ${instance.lag} мс превышает 1000 мс`;
  return null;
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
): Group[] {
  return groups.map((group) => {
    if (group.id !== groupId) return group;
    const master = group.instances.find(
      (instance) => instance.role === "master",
    );
    const target = group.instances.find((instance) => instance.id === targetId);
    if (
      !master?.available ||
      !target ||
      target.role !== "replica" ||
      ineligibleReason(target)
    )
      return group;
    return {
      ...group,
      instances: group.instances.map((instance) => {
        if (instance.id === targetId)
          return { ...instance, role: "master", lag: 0 };
        if (instance.role === "master")
          return { ...instance, role: "replica", lag: 32 };
        return instance;
      }),
    };
  });
}
