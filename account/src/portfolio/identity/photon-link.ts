/** THE ACCOUNT'S SEAM TO PHOTON (iMessage through Photon's hosted relay): the REST project and user calls, the gRPC event stream and
 * the send, behind one interface so the connector never sees a transport. Telemetry is never on: nothing here imports spectrum-ts and
 * nothing goes to otlp.photon.codes. The project secret and line tokens appear in no PhotonError message. */

export const PHOTON_API = "https://spectrum.photon.codes";
export const PHOTON_GRPC = "imessage.spectrum.photon.codes:443";
export const E164 = /^\+[1-9]\d{6,14}$/;
/** a group chat's GUID names its kind between the service and the members: `iMessage;+;chat123` */
export const isGroupChat = (chatGuid: string): boolean => chatGuid.includes(";+;");
export const dmChat = (phone: string): string => `any;-;${phone}`;

export interface PhotonProject {
  projectId: string;
  secret: string;
}
export interface PhotonUser {
  userId: string;
  phone: string;
  line: string;
}
export type PhotonErrorKind = "auth" | "refused" | "retry" | "limit" | "noNumber";
export class PhotonError extends Error {
  constructor(
    readonly kind: PhotonErrorKind,
    readonly code: string,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "PhotonError";
  }
}

export interface PhotonMessage {
  sequence: number;
  guid: string;
  chatGuid: string;
  /** the sender's address: E.164 or an email */
  from: string;
  /** "iMessage", "SMS", "RCS", … */
  service: string;
  fromMe: boolean;
  text?: string;
  /** attachments, or a kind that is not plain text */
  nonText: boolean;
  /** the GUID it answers, when Photon names one */
  replyTo?: string;
}
export type PhotonEvent = { type: "message"; message: PhotonMessage } | { type: "other"; sequence: number };

export interface PhotonStreamHandlers {
  /** in sequence order; the next is read only after this resolves */
  event(e: PhotonEvent): Promise<void>;
  heartbeat(at: number): void;
  /** catch-up could not reach back to `since` */
  gap(): void;
  /** the stream is over; the link does not reopen it */
  failed(err: PhotonError): void;
}
export interface PhotonStream {
  close(): Promise<void>;
}
export interface PhotonLink {
  checkProject(p: PhotonProject, signal?: AbortSignal): Promise<void>;
  findUser(p: PhotonProject, phone: string, signal?: AbortSignal): Promise<PhotonUser | undefined>;
  getUser(p: PhotonProject, userId: string, signal?: AbortSignal): Promise<PhotonUser | undefined>;
  addUser(p: PhotonProject, phone: string, signal?: AbortSignal): Promise<PhotonUser>;
  removeUser(p: PhotonProject, userId: string, signal?: AbortSignal): Promise<void>;
  stream(p: PhotonProject, since: number | undefined, h: PhotonStreamHandlers): PhotonStream;
  sendText(p: PhotonProject, to: string, text: string, clientMessageId: string): Promise<{ guid: string } | { duplicate: true }>;
  dispose(): Promise<void>;
}
