import type { ImportRuntime } from "../src/importer.ts";
import { setPath } from "../src/core.ts";
import type { DocumentSource } from "../src/types.ts";

export interface WorldEvent { op: "createActor" | "createEmbedded" | "update" | "delete"; id: string; type?: string; detail?: string; }

/** The creation label executePlan's order is about: main class, then multiclass, then the item's own type. */
export function itemLabel(source: DocumentSource): string {
  if (source.type === "class") return source.system?.isMulticlass ? "class:multi" : "class:main";
  return String(source.type ?? "");
}

interface FakeActor {
  id: string; uuid: string; name: string; type: string; deleted: boolean;
  system: { updateArmorValue: (data: unknown) => Promise<void> } & Record<string, unknown>;
  flags: Record<string, unknown>; items: unknown[];
  createEmbeddedDocuments(type: string, data: DocumentSource[]): Promise<{ id?: string; _stats?: { compendiumSource?: string | null; duplicateSource?: string | null } }[]>;
  update(data: Record<string, unknown>): Promise<FakeActor | undefined>;
  delete(): Promise<FakeActor | undefined>;
}

/**
 * Records every write executePlan performs. `failAt` declines the Nth write (0-based) the way Foundry does:
 * create returns nothing, update and delete return undefined. A bystander actor is never handed to the import.
 */
export function world(options: { failAt?: number | null; isGM?: boolean } = {}) {
  const events: WorldEvent[] = [];
  const created: FakeActor[] = [];
  const bystander = { id: "existing-hero", name: "Existing hero", deleted: false };
  let writes = 0;
  const declined = () => { const index = writes++; return options.failAt != null && index === options.failAt; };

  const makeActor = (source: DocumentSource): FakeActor => {
    const actor: FakeActor = {
      id: String(source._id), uuid: `Actor.${source._id}`, name: String(source.name ?? source._id), type: String(source.type ?? "character"),
      deleted: false, flags: {}, items: [],
      system: {
        armorScore: { value: 0, max: 0 },
        resources: { hitPoints: { value: 0 }, stress: { value: 0 }, hope: { value: 0 } },
        ...structuredClone(source.system ?? {}),
        updateArmorValue: async () => {},
      },
      createEmbeddedDocuments: async (type, data) => {
        if (declined()) return [];
        events.push({ op: "createEmbedded", id: actor.id, type, detail: data.map(item => itemLabel(item)).join(",") });
        const docs: { id?: string; _stats: { compendiumSource: string | null; duplicateSource: string | null } }[] = data.map(item => ({
          ...structuredClone(item), id: String(item._id), _stats: { compendiumSource: null, duplicateSource: null, ...(item._stats as object) },
        }));
        for (const item of data) for (const link of item.system?.features ?? []) {
          const uuid = typeof link === "string" ? link : link?.item;
          if (typeof uuid === "string") docs.push({ id: `granted-${uuid}`, _stats: { compendiumSource: uuid.startsWith("Compendium.") ? uuid : null, duplicateSource: uuid.startsWith("Compendium.") ? null : uuid } });
        }
        if (type === "Item") actor.items.push(...docs);
        return docs;
      },
      update: async data => {
        if (declined()) return undefined;
        for (const [path, value] of Object.entries(data)) setPath(actor, path, value);
        events.push({ op: "update", id: actor.id });
        return actor;
      },
      delete: async () => {
        if (declined()) return undefined;
        actor.deleted = true;
        events.push({ op: "delete", id: actor.id });
        return actor;
      },
    };
    return actor;
  };

  const runtime: ImportRuntime = {
    version: "2.10.2", moduleVersion: "0.1.2", domains: ["sage"], isGM: options.isGM ?? true, levelupAuto: true, maxLoadout: 5,
    id: () => "generated-id",
    getDocument: async uuid => ({ name: uuid, uuid }),
    preview: source => source,
    createActor: async source => {
      if (declined()) return undefined;
      const actor = makeActor(source);
      created.push(actor);
      events.push({ op: "createActor", id: actor.id, type: actor.type });
      return actor;
    },
    localize: key => key,
  };
  return { runtime, events, created, bystander };
}
