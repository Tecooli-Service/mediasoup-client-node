export declare type ScalabilityMode = {
    spatialLayers: number;
    temporalLayers: number;
};
export declare function parse(scalabilityMode?: string): ScalabilityMode;
