import EventEmitter from './_virtual/index.mjs';
import { ClosePayload, parseIncomingPayload } from './schema/index.mjs';
import commands from './commands/index.mjs';
import { SDKError } from './error.mjs';
import { Events, ERROR } from './schema/events.mjs';
import { Platform, UNKNOWN_VERSION_NUMBER, HANDSHAKE_SDK_VERSION_MINIMUM_MOBILE_VERSION } from './Constants.mjs';
import getDefaultSdkConfiguration from './utils/getDefaultSdkConfiguration.mjs';
import { consoleLevels, wrapConsoleMethod } from './utils/console.mjs';
import { version } from './package.json.mjs';
import { Commands } from './schema/common.mjs';
import v4 from './lib/uuid/dist/esm-browser/v4.mjs';

var Opcodes;
(function (Opcodes) {
    Opcodes[Opcodes["HANDSHAKE"] = 0] = "HANDSHAKE";
    Opcodes[Opcodes["FRAME"] = 1] = "FRAME";
    Opcodes[Opcodes["CLOSE"] = 2] = "CLOSE";
    Opcodes[Opcodes["HELLO"] = 3] = "HELLO";
})(Opcodes || (Opcodes = {}));
const ALLOWED_ORIGINS = new Set(getAllowedOrigins());
// Captured at module load before any console override so debug logs in handleMessage
// are always safe (no risk of the postMessage → captureLog → handleMessage infinite loop).
const _nativeDebug = console.debug.bind(console);
function getAllowedOrigins() {
    if (typeof window === 'undefined')
        return [];
    return [
        window.location.origin,
        'https://discord.com',
        'https://discordapp.com',
        'https://ptb.discord.com',
        'https://ptb.discordapp.com',
        'https://canary.discord.com',
        'https://canary.discordapp.com',
        'https://staging.discord.co',
        'http://localhost:3333',
        'https://pax.discord.com',
        'null',
    ];
}
/**
 * The embedded application is running in an IFrame either within the main Discord client window or in a popout. The RPC server is always running in the main Discord client window. In either case, the referrer is the correct origin.
 */
function getRPCServerSource() {
    var _a;
    return [(_a = window.parent.opener) !== null && _a !== void 0 ? _a : window.parent, '*'];
}
class DiscordSDK {
    getTransfer(payload) {
        var _a;
        switch (payload.cmd) {
            case Commands.SUBSCRIBE:
            case Commands.UNSUBSCRIBE:
                return undefined;
            default:
                return (_a = payload.transfer) !== null && _a !== void 0 ? _a : undefined;
        }
    }
    constructor(clientId, configuration) {
        var _a;
        this.sdkVersion = version;
        this.mobileAppVersion = null;
        this.source = null;
        this.sourceOrigin = '';
        this.eventBus = new EventEmitter();
        this.onReadyCallback = () => {
            this._debug('READY received from Discord — setting isReady = true');
            this.overrideConsoleLogging();
            this.isReady = true;
        };
        this.pendingCommands = new Map();
        this.sendCommand = (payload) => {
            var _a;
            if (this.source == null)
                throw new Error('Attempting to send message before initialization');
            const nonce = v4();
            (_a = this.source) === null || _a === void 0 ? void 0 : _a.postMessage([Opcodes.FRAME, Object.assign(Object.assign({}, payload), { nonce })], this.sourceOrigin, this.getTransfer(payload));
            const promise = new Promise((resolve, reject) => {
                this.pendingCommands.set(nonce, { resolve, reject });
            });
            return promise;
        };
        this.commands = commands(this.sendCommand);
        /**
         * WARNING - All "console" logs are emitted as messages to the Discord client
         *  If you write "console.log" anywhere in handleMessage or subsequent message handling
         * there is a good chance you will cause an infinite loop where you receive a message
         * which causes "console.log" which sends a message, which causes the discord client to
         * send a reply which causes handleMessage to fire again, and again to inifinity
         *
         * If you need to log within handleMessage, consider setting
         * config.disableConsoleLogOverride to true when initializing the SDK
         */
        this.handleMessage = (event) => {
            const isArray = Array.isArray(event.data);
            const opcode = isArray ? event.data[0] : undefined;
            this._debug('message received —', 'origin:', event.origin, '| inAllowlist:', ALLOWED_ORIGINS.has(event.origin), '| isArray:', isArray, '| opcode:', opcode, '| opcodeName:', opcode === Opcodes.HANDSHAKE ? 'HANDSHAKE' : opcode === Opcodes.FRAME ? 'FRAME' : opcode === Opcodes.CLOSE ? 'CLOSE' : opcode === Opcodes.HELLO ? 'HELLO' : 'unknown');
            if (!ALLOWED_ORIGINS.has(event.origin)) {
                this._debug('message DROPPED — origin not in allowlist. Allowlist:', [...ALLOWED_ORIGINS]);
                return;
            }
            const tuple = event.data;
            if (!Array.isArray(tuple)) {
                return;
            }
            const [opcodeValue, data] = tuple;
            switch (opcodeValue) {
                case Opcodes.HELLO:
                    // backwards compat; the Discord client will still send HELLOs for old applications.
                    //
                    // TODO: figure out compatibility approach; it would be easier to maintain compatibility at the SDK level, not the underlying RPC protocol level...
                    this._debug('HELLO received (backwards compat, ignored)');
                    return;
                case Opcodes.CLOSE:
                    this._debug('CLOSE received');
                    return this.handleClose(data);
                case Opcodes.HANDSHAKE:
                    this._debug('inbound HANDSHAKE received (no-op)');
                    return this.handleHandshake();
                case Opcodes.FRAME:
                    this._debug('FRAME received — cmd:', data === null || data === void 0 ? void 0 : data.cmd, '| evt:', data === null || data === void 0 ? void 0 : data.evt);
                    return this.handleFrame(data);
                default:
                    throw new Error('Invalid message format');
            }
        };
        this.isReady = false;
        this.clientId = clientId;
        this.configuration = configuration !== null && configuration !== void 0 ? configuration : getDefaultSdkConfiguration();
        if (typeof window !== 'undefined') {
            window.addEventListener('message', this.handleMessage);
        }
        if (typeof window === 'undefined') {
            this.frameId = '';
            this.instanceId = '';
            this.customId = null;
            this.referrerId = null;
            this.platform = Platform.DESKTOP;
            this.guildId = null;
            this.channelId = null;
            this.locationId = null;
            return;
        }
        // START Capture URL Query Params
        const urlParams = new URLSearchParams(this._getSearch());
        const frameId = urlParams.get('frame_id');
        if (!frameId) {
            throw new Error('frame_id query param is not defined');
        }
        this.frameId = frameId;
        const instanceId = urlParams.get('instance_id');
        if (!instanceId) {
            throw new Error('instance_id query param is not defined');
        }
        this.instanceId = instanceId;
        const platform = urlParams.get('platform');
        if (!platform) {
            throw new Error('platform query param is not defined');
        }
        else if (platform !== Platform.DESKTOP && platform !== Platform.MOBILE) {
            throw new Error(`Invalid query param "platform" of "${platform}". Valid values are "${Platform.DESKTOP}" or "${Platform.MOBILE}"`);
        }
        this.platform = platform;
        this.customId = urlParams.get('custom_id');
        this.referrerId = urlParams.get('referrer_id');
        this.guildId = urlParams.get('guild_id');
        this.channelId = urlParams.get('channel_id');
        this.locationId = urlParams.get('location_id');
        this.mobileAppVersion = urlParams.get('mobile_app_version');
        // END Capture URL Query Params
        [this.source, this.sourceOrigin] = getRPCServerSource();
        this._debug('constructed —', 'clientId:', this.clientId, '| frameId:', this.frameId, '| sourceOrigin:', this.sourceOrigin, '| document.referrer:', typeof document !== 'undefined' ? (document.referrer || '(empty)') : '(no document)', '| source is window.parent:', this.source === window.parent, '| allowedOrigins:', [...ALLOWED_ORIGINS], '| disableAutoHandshake:', (_a = this.configuration.disableAutoHandshake) !== null && _a !== void 0 ? _a : false);
        if (!this.configuration.disableAutoHandshake) {
            this.handshake();
        }
        else {
            this._debug('auto-handshake suppressed — call sdk.handshake() manually');
        }
    }
    close(code, message) {
        var _a;
        window.removeEventListener('message', this.handleMessage);
        const nonce = v4();
        (_a = this.source) === null || _a === void 0 ? void 0 : _a.postMessage([Opcodes.CLOSE, { code, message, nonce }], this.sourceOrigin);
    }
    async subscribe(event, listener, ...rest) {
        const [subscribeArgs] = rest;
        const listenerCount = this.eventBus.listenerCount(event);
        const emitter = this.eventBus.on(event, listener);
        // If first subscription, subscribe via RPC
        if (Object.values(Events).includes(event) && event !== Events.READY && listenerCount === 0) {
            await this.sendCommand({
                cmd: Commands.SUBSCRIBE,
                args: subscribeArgs,
                evt: event,
            });
        }
        return emitter;
    }
    async unsubscribe(event, listener, ...rest) {
        const [unsubscribeArgs] = rest;
        if (event !== Events.READY && this.eventBus.listenerCount(event) === 1) {
            await this.sendCommand({
                cmd: Commands.UNSUBSCRIBE,
                evt: event,
                args: unsubscribeArgs,
            });
        }
        return this.eventBus.off(event, listener);
    }
    async ready() {
        if (this.isReady) {
            this._debug('ready() called — already ready, resolving immediately');
            return;
        }
        this._debug('ready() called — not yet ready, waiting for READY event...');
        await new Promise((resolve) => {
            this.eventBus.once(Events.READY, () => {
                this._debug('ready() resolved via READY event');
                resolve();
            });
        });
    }
    parseMajorMobileVersion() {
        if (this.mobileAppVersion && this.mobileAppVersion.includes('.')) {
            try {
                return parseInt(this.mobileAppVersion.split('.')[0]);
            }
            catch (_a) {
                return UNKNOWN_VERSION_NUMBER;
            }
        }
        return UNKNOWN_VERSION_NUMBER;
    }
    handshake() {
        var _a;
        this._debug('handshake() called —', '| sourceOrigin (targetOrigin for postMessage):', this.sourceOrigin, '| source is null:', this.source == null, '| document.referrer at call time:', typeof document !== 'undefined' ? (document.referrer || '(empty)') : '(no document)');
        this.isReady = false;
        this.addOnReadyListener();
        const handshakePayload = {
            v: 1,
            encoding: 'json',
            client_id: this.clientId,
            frame_id: this.frameId,
        };
        const majorMobileVersion = this.parseMajorMobileVersion();
        if (this.platform === Platform.DESKTOP || majorMobileVersion >= HANDSHAKE_SDK_VERSION_MINIMUM_MOBILE_VERSION) {
            handshakePayload['sdk_version'] = this.sdkVersion;
        }
        this._debug('handshake() dispatching postMessage:', JSON.stringify([Opcodes.HANDSHAKE, handshakePayload]));
        (_a = this.source) === null || _a === void 0 ? void 0 : _a.postMessage([Opcodes.HANDSHAKE, handshakePayload], this.sourceOrigin);
        if (this.source == null) {
            this._debug('handshake() WARNING: source is null — postMessage was NOT sent');
        }
    }
    addOnReadyListener() {
        this.eventBus.off(Events.READY, this.onReadyCallback);
        this.eventBus.once(Events.READY, this.onReadyCallback);
    }
    overrideConsoleLogging() {
        if (this.configuration.disableConsoleLogOverride)
            return;
        const sendCaptureLogCommand = (level, message) => {
            this.commands.captureLog({
                level,
                message,
            });
        };
        consoleLevels.forEach((level) => {
            wrapConsoleMethod(console, level, sendCaptureLogCommand);
        });
    }
    handleClose(data) {
        ClosePayload.parse(data);
    }
    handleHandshake() { }
    handleFrame(payload) {
        var _a, _b;
        let parsed;
        try {
            parsed = parseIncomingPayload(payload);
        }
        catch (e) {
            console.error('Failed to parse', payload);
            console.error(e);
            return;
        }
        if (parsed.cmd === 'DISPATCH') {
            this.eventBus.emit(parsed.evt, parsed.data);
        }
        else {
            if (parsed.evt === ERROR) {
                // In response to a command
                if (parsed.nonce != null) {
                    (_a = this.pendingCommands.get(parsed.nonce)) === null || _a === void 0 ? void 0 : _a.reject(parsed.data);
                    this.pendingCommands.delete(parsed.nonce);
                    return;
                }
                // General error
                this.eventBus.emit('error', new SDKError(parsed.data.code, parsed.data.message));
            }
            if (parsed.nonce == null) {
                console.error('Missing nonce', payload);
                return;
            }
            (_b = this.pendingCommands.get(parsed.nonce)) === null || _b === void 0 ? void 0 : _b.resolve(parsed);
            this.pendingCommands.delete(parsed.nonce);
        }
    }
    _debug(...args) {
        if (this.configuration.debugHandshake) {
            _nativeDebug('[DiscordSDK]', ...args);
        }
    }
    _getSearch() {
        return typeof window === 'undefined' ? '' : window.location.search;
    }
}

export { DiscordSDK, Opcodes };
