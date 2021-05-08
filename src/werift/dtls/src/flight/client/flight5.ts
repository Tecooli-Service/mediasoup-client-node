import { ServerHello } from "../../handshake/message/server/hello";
import { Certificate } from "../../handshake/message/certificate";
import { ServerHelloDone } from "../../handshake/message/server/helloDone";
import { HandshakeType } from "../../handshake/const";
import { DtlsContext } from "../../context/dtls";
import { ServerKeyExchange } from "../../handshake/message/server/keyExchange";
import { generateKeyPair } from "../../cipher/namedCurve";
import {
  prfPreMasterSecret,
  prfMasterSecret,
  prfExtendedMasterSecret,
} from "../../cipher/prf";
import { ClientKeyExchange } from "../../handshake/message/client/keyExchange";
import { ChangeCipherSpec } from "../../handshake/message/changeCipherSpec";
import { Finished } from "../../handshake/message/finished";
import { createPlaintext } from "../../record/builder";
import { TransportContext } from "../../context/transport";
import { DtlsRandom } from "../../handshake/random";
import { ContentType } from "../../record/const";
import { createCipher } from "../../cipher/create";
import { CipherContext } from "../../context/cipher";
import { ServerCertificateRequest } from "../../handshake/message/server/certificateRequest";
import { CertificateVerify } from "../../handshake/message/client/certificateVerify";
import { UseSRTP } from "../../handshake/extensions/useSrtp";
import { SrtpContext } from "../../context/srtp";
import { Flight } from "../flight";
import { FragmentedHandshake } from "../../record/message/fragment";
import debug from "debug";
import { ExtendedMasterSecret } from "../../handshake/extensions/extendedMasterSecret";
import { RenegotiationIndication } from "../../handshake/extensions/renegotiationIndication";
import { SignatureAlgorithm, SignatureScheme } from "../../cipher/const";

const log = debug("werift/dtls/flight/client/flight5");

export class Flight5 extends Flight {
  constructor(
    udp: TransportContext,
    dtls: DtlsContext,
    private cipher: CipherContext,
    private srtp: SrtpContext
  ) {
    super(udp, dtls, 5, 7);
  }

  handleHandshake(handshake: FragmentedHandshake) {
    this.dtls.bufferHandshakeCache([handshake], false, 4);
    const message = (() => {
      switch (handshake.msg_type) {
        case HandshakeType.server_hello:
          return ServerHello.deSerialize(handshake.fragment);
        case HandshakeType.certificate:
          return Certificate.deSerialize(handshake.fragment);
        case HandshakeType.server_key_exchange:
          return ServerKeyExchange.deSerialize(handshake.fragment);
        case HandshakeType.certificate_request:
          return ServerCertificateRequest.deSerialize(handshake.fragment);
        case HandshakeType.server_hello_done:
          return ServerHelloDone.deSerialize(handshake.fragment);
      }
    })();

    if (message) {
      handlers[message.msgType]({
        dtls: this.dtls,
        cipher: this.cipher,
        srtp: this.srtp,
      })(message);
    }
  }

  exec() {
    if (this.dtls.flight === 5) {
      log("flight5 twice");
      this.send(this.dtls.lastMessage);
      return;
    }
    this.dtls.flight = 5;

    const packets = [
      this.dtls.requestedCertificateTypes.length > 0 && this.sendCertificate(),
      this.sendClientKeyExchange(),
      this.dtls.requestedCertificateTypes.length > 0 &&
        this.sendCertificateVerify(),
      this.sendChangeCipherSpec(),
      this.sendFinished(),
    ].filter((v) => v) as Buffer[];

    this.dtls.lastMessage = packets;
    this.transmit(packets);
  }

  sendCertificate() {
    const certificate = new Certificate([Buffer.from(this.cipher.localCert)]);

    const packets = this.createPacket([certificate]);

    const buf = Buffer.concat(packets.map((v) => v.serialize()));
    return buf;
  }

  sendClientKeyExchange() {
    if (!this.cipher.localKeyPair) throw new Error();

    const clientKeyExchange = new ClientKeyExchange(
      this.cipher.localKeyPair.publicKey
    );
    const packets = this.createPacket([clientKeyExchange]);
    const buf = Buffer.concat(packets.map((v) => v.serialize()));

    const localKeyPair = this.cipher.localKeyPair!;
    const remoteKeyPair = this.cipher.remoteKeyPair!;

    const preMasterSecret = prfPreMasterSecret(
      remoteKeyPair.publicKey!,
      localKeyPair.privateKey,
      localKeyPair.curve
    );

    log(
      "extendedMasterSecret",
      this.dtls.options.extendedMasterSecret,
      this.dtls.remoteExtendedMasterSecret
    );

    const handshakes = Buffer.concat(
      this.dtls.handshakeCache.map((v) => v.data.serialize())
    );
    this.cipher.masterSecret =
      this.dtls.options.extendedMasterSecret &&
      this.dtls.remoteExtendedMasterSecret
        ? prfExtendedMasterSecret(preMasterSecret, handshakes)
        : prfMasterSecret(
            preMasterSecret,
            this.cipher.localRandom!.serialize(),
            this.cipher.remoteRandom!.serialize()
          );

    this.cipher.cipher = createCipher(this.cipher.cipherSuite!);
    this.cipher.cipher.init(
      this.cipher.masterSecret,
      this.cipher.remoteRandom!.serialize(),
      this.cipher.localRandom!.serialize()
    );

    return buf;
  }

  sendCertificateVerify() {
    const cache = Buffer.concat(
      this.dtls.handshakeCache.map((v) => v.data.serialize())
    );
    const signed = this.cipher.signatureData(cache, "sha256");
    const signatureScheme = (() => {
      switch (this.cipher.signatureHashAlgorithm?.signature) {
        case SignatureAlgorithm.ecdsa:
          return SignatureScheme.ecdsa_secp256r1_sha256;
        case SignatureAlgorithm.rsa:
          return SignatureScheme.rsa_pkcs1_sha256;
      }
    })();
    if (!signatureScheme) throw new Error();
    log(
      "signatureScheme",
      this.cipher.signatureHashAlgorithm?.signature,
      signatureScheme
    );

    const certificateVerify = new CertificateVerify(signatureScheme, signed);
    const packets = this.createPacket([certificateVerify]);
    const buf = Buffer.concat(packets.map((v) => v.serialize()));
    return buf;
  }

  sendChangeCipherSpec() {
    const changeCipherSpec = ChangeCipherSpec.createEmpty().serialize();
    const packets = createPlaintext(this.dtls)(
      [{ type: ContentType.changeCipherSpec, fragment: changeCipherSpec }],
      ++this.dtls.recordSequenceNumber
    );
    const buf = Buffer.concat(packets.map((v) => v.serialize()));
    return buf;
  }

  sendFinished() {
    const cache = Buffer.concat(
      this.dtls.handshakeCache.map((v) => v.data.serialize())
    );
    const localVerifyData = this.cipher.verifyData(cache);

    const finish = new Finished(localVerifyData);
    this.dtls.epoch = 1;
    const [packet] = this.createPacket([finish]);

    this.dtls.recordSequenceNumber = 0;

    const buf = this.cipher.encryptPacket(packet).serialize();
    return buf;
  }
}

const handlers: {
  [key: number]: (contexts: {
    dtls: DtlsContext;
    cipher: CipherContext;
    srtp: SrtpContext;
  }) => (message: any) => void;
} = {};

handlers[HandshakeType.server_hello] = ({ cipher, srtp, dtls }) => (
  message: ServerHello
) => {
  log("serverHello", message);
  cipher.remoteRandom = DtlsRandom.from(message.random);
  cipher.cipherSuite = message.cipherSuite;
  log("selected cipherSuite", cipher.cipherSuite);

  if (message.extensions) {
    message.extensions.forEach((extension) => {
      switch (extension.type) {
        case UseSRTP.type:
          const useSrtp = UseSRTP.fromData(extension.data);
          const profile = SrtpContext.findMatchingSRTPProfile(
            useSrtp.profiles,
            dtls.options.srtpProfiles || []
          );
          log("selected srtp profile", profile);
          if (profile == undefined) return;
          srtp.srtpProfile = profile;
          break;
        case ExtendedMasterSecret.type:
          dtls.remoteExtendedMasterSecret = true;
          break;
        case RenegotiationIndication.type:
          log("RenegotiationIndication", extension.data);
          break;
      }
    });
  }
};

handlers[HandshakeType.certificate] = ({ cipher }) => (
  message: Certificate
) => {
  log("handshake certificate", message);
  cipher.remoteCertificate = message.certificateList[0];
};

handlers[HandshakeType.server_key_exchange] = ({ cipher }) => (
  message: ServerKeyExchange
) => {
  if (!cipher.localRandom || !cipher.remoteRandom) throw new Error();
  log("ServerKeyExchange", message);

  log("selected curve", message.namedCurve);
  cipher.remoteKeyPair = {
    curve: message.namedCurve,
    publicKey: message.publicKey,
  };
  cipher.localKeyPair = generateKeyPair(message.namedCurve);
};

handlers[HandshakeType.server_hello_done] = () => (msg) => {
  log("server_hello_done", msg);
};

handlers[HandshakeType.certificate_request] = ({ dtls }) => (
  message: ServerCertificateRequest
) => {
  log("certificate_request", message);
  dtls.requestedCertificateTypes = message.certificateTypes;
  dtls.requestedSignatureAlgorithms = message.signatures;
};
