import { EnhancedEventEmitter } from './EnhancedEventEmitter';
import { Transport, TransportOptions } from './Transport';
import { HandlerFactory } from './handlers/HandlerInterface';
import { RtpCapabilities, MediaKind } from './RtpParameters';
import { SctpCapabilities } from './SctpParameters';
import { RTCRtpCodecParameters, RTCRtpHeaderExtensionParameters } from 'werift';
export declare type BuiltinHandlerName = 'Chrome74' | 'Chrome70' | 'Chrome67' | 'Chrome55' | 'Firefox60' | 'Safari12' | 'Safari11' | 'Edge11' | 'ReactNative' | 'werift';
export declare type DeviceOptions = {
    /**
     * The name of one of the builtin handlers.
     */
    handlerName?: BuiltinHandlerName;
    /**
     * Custom handler factory.
     */
    handlerFactory?: HandlerFactory;
    /**
     * DEPRECATED!
     * The name of one of the builtin handlers.
     */
    Handler?: string;
};
export interface WeriftRtpCapabilities {
    codecs: Partial<{
        audio: RTCRtpCodecParameters[];
        video: RTCRtpCodecParameters[];
    }>;
    headerExtensions: Partial<{
        audio: RTCRtpHeaderExtensionParameters[];
        video: RTCRtpHeaderExtensionParameters[];
    }>;
}
export declare function detectDevice(): BuiltinHandlerName | undefined;
export declare class Device {
    private readonly _handlerFactory;
    private readonly _handlerName;
    private _loaded;
    private _extendedRtpCapabilities?;
    private _recvRtpCapabilities?;
    private readonly _canProduceByKind;
    private _sctpCapabilities?;
    protected readonly _observer: EnhancedEventEmitter;
    /**
     * Create a new Device to connect to mediasoup server.
     *
     * @throws {UnsupportedError} if device is not supported.
     */
    constructor(weriftRtpCapabilities: WeriftRtpCapabilities, { handlerName, handlerFactory, Handler }?: DeviceOptions);
    /**
     * The RTC handler name.
     */
    get handlerName(): string;
    /**
     * Whether the Device is loaded.
     */
    get loaded(): boolean;
    /**
     * RTP capabilities of the Device for receiving media.
     *
     * @throws {InvalidStateError} if not loaded.
     */
    get rtpCapabilities(): RtpCapabilities;
    /**
     * SCTP capabilities of the Device.
     *
     * @throws {InvalidStateError} if not loaded.
     */
    get sctpCapabilities(): SctpCapabilities;
    /**
     * Observer.
     *
     * @emits newtransport - (transport: Transport)
     */
    get observer(): EnhancedEventEmitter;
    /**
     * Initialize the Device.
     */
    load({ routerRtpCapabilities }: {
        routerRtpCapabilities: RtpCapabilities;
    }): Promise<void>;
    /**
     * Whether we can produce audio/video.
     *
     * @throws {InvalidStateError} if not loaded.
     * @throws {TypeError} if wrong arguments.
     */
    canProduce(kind: MediaKind): boolean;
    /**
     * Creates a Transport for sending media.
     *
     * @throws {InvalidStateError} if not loaded.
     * @throws {TypeError} if wrong arguments.
     */
    createSendTransport({ id, iceParameters, iceCandidates, dtlsParameters, sctpParameters, iceServers, iceTransportPolicy, additionalSettings, proprietaryConstraints, appData }: TransportOptions): Transport;
    /**
     * Creates a Transport for receiving media.
     *
     * @throws {InvalidStateError} if not loaded.
     * @throws {TypeError} if wrong arguments.
     */
    createRecvTransport({ id, iceParameters, iceCandidates, dtlsParameters, sctpParameters, iceServers, iceTransportPolicy, additionalSettings, proprietaryConstraints, appData }: TransportOptions): Transport;
    private _createTransport;
}
