// TokenMagic patches these onto PIXI.Filter.prototype at load (fx/filters/proto/FilterProto.js),
// so every LA custom filter carries them at runtime.

export {};

declare module "@pixi/core"
{
    interface Filter
    {
        setTMParams(params: any): void;
        normalizeTMParams(): void;
        dummy: boolean;
    }
}
