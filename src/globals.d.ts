// Foundry globals are deliberately isolated to the adapter and UI. Core parsing is platform independent.
declare const game: any;
declare const ui: any;
declare const foundry: any;
declare const CONFIG: any;
declare const CONST: any;
declare const Hooks: any;
declare const Actor: any;
declare const Item: any;
declare function fromUuid(uuid: string): Promise<any>;
