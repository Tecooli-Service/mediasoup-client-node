import { v4 as uuid } from "uuid";
import {
  PictureLossIndication,
  RtcpPacket,
  RtcpPayloadSpecificFeedback,
  RtcpRrPacket,
  RtcpSrPacket,
  RtpPacket,
} from "../../../rtp/src";
import { RTP_EXTENSION_URI } from "../extension/rtpExtension";
import { sleep } from "../helper";
import { RTCDtlsTransport } from "../transport/dtls";
import { Kind } from "../types/domain";
import { Nack } from "./nack";
import { RTCRtpCodecParameters } from "./parameters";
import { ReceiverTWCC } from "./receiver/receiverTwcc";
import { Extensions } from "./router";
import { MediaStreamTrack } from "./track";

export class RTCRtpReceiver {
  readonly type = "receiver";
  readonly uuid = uuid();
  readonly tracks: MediaStreamTrack[] = [];
  readonly trackBySSRC: { [ssrc: string]: MediaStreamTrack } = {};
  readonly trackByRID: { [rid: string]: MediaStreamTrack } = {};
  readonly nack = new Nack(this);
  readonly lsr: { [key: number]: BigInt } = {};
  readonly lsrTime: { [key: number]: number } = {};

  sdesMid?: string;
  rid?: string;
  receiverTWCC?: ReceiverTWCC;
  supportTWCC = false;
  codecs: RTCRtpCodecParameters[] = [];

  constructor(
    public kind: Kind,
    public dtlsTransport: RTCDtlsTransport,
    public rtcpSsrc: number
  ) {}

  /**
   * setup TWCC if supported
   * @param mediaSourceSsrc
   */
  setupTWCC(mediaSourceSsrc?: number) {
    this.supportTWCC = !!this.codecs.find((codec) =>
      codec.rtcpFeedback.find((v) => v.type === "transport-cc")
    );
    if (this.supportTWCC && mediaSourceSsrc) {
      this.receiverTWCC = new ReceiverTWCC(
        this.dtlsTransport,
        this.rtcpSsrc,
        mediaSourceSsrc
      );
    }
  }

  addTrack(track: MediaStreamTrack) {
    const exist = this.tracks.find((t) => {
      if (t.rid) return t.rid === track.rid;
      if (t.ssrc) return t.ssrc === track.ssrc;
    });
    if (!exist) {
      this.tracks.push(track);
      if (track.ssrc) this.trackBySSRC[track.ssrc] = track;
      if (track.rid) this.trackByRID[track.rid] = track;
      return true;
    }
    return false;
  }

  stop() {
    this.rtcpRunning = false;
    if (this.receiverTWCC) this.receiverTWCC.twccRunning = false;
  }

  rtcpRunning = false;
  async runRtcp() {
    if (this.rtcpRunning) return;
    this.rtcpRunning = true;

    while (this.rtcpRunning) {
      await sleep(500 + Math.random() * 1000);

      const reports = [];
      const packet = new RtcpRrPacket({ ssrc: this.rtcpSsrc, reports });

      try {
        await this.dtlsTransport.sendRtcp([packet]);
      } catch (error) {
        await sleep(500 + Math.random() * 1000);
      }
    }
  }

  async sendRtcpPLI(mediaSsrc: number) {
    const packet = new RtcpPayloadSpecificFeedback({
      feedback: new PictureLossIndication({
        senderSsrc: this.rtcpSsrc,
        mediaSsrc,
      }),
    });
    try {
      await this.dtlsTransport.sendRtcp([packet]);
    } catch (error) {}
  }

  handleRtcpPacket(packet: RtcpPacket) {
    switch (packet.type) {
      case RtcpSrPacket.type:
        {
          const sr = packet as RtcpSrPacket;
          this.lsr[sr.ssrc] = (sr.senderInfo.ntpTimestamp >> 16n) & 0xffffffffn;
          this.lsrTime[sr.ssrc] = Date.now() / 1000;
        }
        break;
    }
  }

  handleRtpBySsrc = (packet: RtpPacket, extensions: Extensions) => {
    const track = this.trackBySSRC[packet.header.ssrc];
    if (!track) throw new Error();

    this.handleRTP(track, packet, extensions);
  };

  handleRtpByRid = (packet: RtpPacket, rid: string, extensions: Extensions) => {
    const track = this.trackByRID[rid];
    if (!track) throw new Error();

    this.handleRTP(track, packet, extensions);
  };

  private handleRTP(
    track: MediaStreamTrack,
    packet: RtpPacket,
    extensions: Extensions
  ) {
    if (this.receiverTWCC) {
      const transportSequenceNumber = extensions[
        RTP_EXTENSION_URI.transportWideCC
      ] as number;
      if (!transportSequenceNumber == undefined) throw new Error();

      this.receiverTWCC.handleTWCC(transportSequenceNumber);
    } else if (this.supportTWCC) {
      this.setupTWCC(packet.header.ssrc);
    }

    if (track.kind === "video") this.nack.onPacket(packet);
    track.onReceiveRtp.execute(packet);

    this.runRtcp();
  }
}
