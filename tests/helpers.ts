import { parseFields } from "../src/core.ts";
import type { ImportRuntime } from "../src/importer.ts";
import type { DocumentSource, ParsedCharacter } from "../src/types.ts";

export function character(extra = {}): ParsedCharacter {
  return parseFields({ name: "Fixture character", heritage: "Testfolk", class: "Fixture Class - Fixture Path", level: "1", agility: "1", strength: "0", finesse: "0", instinct: "2", presence: "-1", knowledge: "1", hp_max: "6", stress_max: "6", evasion: "10", ancestry_name: "Fixture Ancestry", "hope.0": "Yes", "hope.1": "Yes", "proficiency.0": "Yes", ...extra });
}
export function mockRuntime(documents: Record<string, DocumentSource> = {}) {
  let serial = 0;
  const created: any[] = [], operations: string[] = [];
  const runtime: ImportRuntime = {
    version: "2.10.2", moduleVersion: "test", domains: ["sage", "arcana"], isGM: true,
    id: () => String(++serial).padStart(16, "0"), localize: key => key,
    getDocument: async uuid => documents[uuid] ? { ...documents[uuid], toObject: () => structuredClone(documents[uuid]) } : null,
    // A deterministic stub isolates planning/transaction tests. Live Foundry verifies actual preparation.
    preview: source => ({ ...source, system: { ...source.system, evasion: 10, armorScore: { max: 4, value: 0 }, damageThresholds: { major: 7, severe: 14 }, resources: { hitPoints: { max: 6, value: 0 }, stress: { max: 6, value: 0 }, hope: { max: 6, value: 2 } } } }),
    createActor: async source => {
      const actor = runtime.preview(source);
      actor.id = source._id; actor.uuid = `Actor.${source._id}`;
      actor.createEmbeddedDocuments = async (_type: string, data: any[]) => { operations.push(...data.map(d => d.type)); return data.map(d => ({ id: d._id })); };
      actor.update = async (data: any) => {
        for (const [path, value] of Object.entries(data)) {
          const parts = path.split("."); let obj = actor;
          for (const k of parts.slice(0, -1)) obj = obj[k] ??= {};
          obj[parts.at(-1)!] = value;
        }
      };
      actor.delete = async () => { actor.deleted = true; operations.push(`delete:${actor.type}`); };
      created.push(actor); return actor;
    }
  };
  return { runtime, created, operations };
}
