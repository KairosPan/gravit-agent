// A live check of a real Photon project, run by the operator in their own terminal:
//   PHOTON_PROJECT_ID=… PHOTON_PROJECT_SECRET=… PHOTON_PHONE=+1… npm run photon:check
// It prints neither the project secret nor a line token. The summary block at the end holds no secret.
import { E164, isGroupChat, PhotonError, type PhotonEvent, type PhotonMessage, type PhotonProject, type PhotonStream, type PhotonUser } from "../src/portfolio/identity/photon-link.ts";
import { realPhotonLink } from "../src/portfolio/identity/photon-real.ts";

const projectId = process.env.PHOTON_PROJECT_ID ?? "";
const secret = process.env.PHOTON_PROJECT_SECRET ?? "";
const phone = process.env.PHOTON_PHONE ?? "";
if (!projectId || !secret || !E164.test(phone)) {
  console.error("photon:check needs PHOTON_PROJECT_ID, PHOTON_PROJECT_SECRET and PHOTON_PHONE (E.164, like +15551234567) in the environment");
  process.exit(1);
}

const project: PhotonProject = { projectId, secret };
const codes = new Set<string>();
let expiresIn: number | undefined;
// the link logs "line token minted (renews in N s)" and never the token; N is 80% of expiresIn
const link = realPhotonLink({
  log: (l) => {
    const m = /renews in (\d+) s/.exec(l);
    if (m) expiresIn = Math.round(Number(m[1]) / 0.8);
  },
});
const say = (s: string): void => console.log(s);
const note = (e: unknown): void => {
  if (e instanceof PhotonError) codes.add(`${e.kind}:${e.code}`);
};
const guard = async <T>(f: () => Promise<T>): Promise<T> => {
  try {
    return await f();
  } catch (e) {
    note(e);
    throw e;
  }
};
const normal = (s: string): string => s.replace(/\D/g, "");
const showUser = (u: PhotonUser | undefined): void => say(u ? `  line ${u.line} (user ${u.userId}, phone ${u.phone})` : "  no such user");

const events: PhotonMessage[] = [];
const open = (since: number | undefined, onMessage: (m: PhotonMessage) => void): PhotonStream =>
  link.stream(project, since, {
    event: async (e: PhotonEvent) => {
      if (e.type !== "message") return say(`  event #${e.sequence} (not a message)`);
      const m = e.message;
      say(`  event #${m.sequence} guid=${m.guid} service=${m.service} fromPhone=${normal(m.from) === normal(phone)} fromMe=${m.fromMe}${m.replyTo ? ` replyTo=${m.replyTo}` : ""}`);
      events.push(m);
      onMessage(m);
    },
    heartbeat: (at) => say(`  heartbeat ${new Date(at).toISOString()}`),
    gap: () => say("  gap: catch-up could not reach back"),
    failed: (err) => {
      note(err);
      say(`  stream failed: ${err.kind}:${err.code}`);
    },
  });

async function main(): Promise<void> {
  say(`1. node ${process.version}`);
  await guard(() => link.checkProject(project));
  say("   checkProject: ok");

  say("2. user");
  const user = (await guard(() => link.findUser(project, phone))) ?? (await guard(() => link.addUser(project, phone)));
  showUser(user);

  say("3. stream (since undefined); text \"hi\" to the line within 5 minutes");
  let hi: PhotonMessage | undefined;
  let onHi: () => void = () => {};
  const gotHi = new Promise<void>((r) => (onHi = r));
  const first = open(undefined, (m) => {
    if (hi || m.fromMe || normal(m.from) !== normal(phone)) return;
    if (m.service !== "iMessage" || isGroupChat(m.chatGuid)) return say(`  ignored: from the phone but not a 1:1 iMessage (service ${m.service})`);
    hi = m;
    onHi();
  });
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([gotHi, new Promise<void>((r) => (timer = setTimeout(r, 5 * 60_000)))]);
  clearTimeout(timer);
  if (!hi) {
    await first.close();
    await link.dispose();
    say("no message from the phone arrived in five minutes; stopping");
    process.exit(1);
  }

  say("4. two replies under one clientMessageId");
  const clientId = `photon-check:${Date.now()}`;
  // sendText takes the phone and builds the 1:1 chat itself: the operator's number as typed (E.164), which the hi came from
  const to = phone;
  let longest = 0;
  let replyGuid: string | undefined;
  // unknown until the second send answers: a send that throws, or never made, says nothing either way
  let secondDuplicate: boolean | undefined;
  for (const len of [4000, 1000, 200]) {
    const text = "photon:check ".repeat(Math.ceil(len / 13)).slice(0, len);
    let r: { guid: string } | { duplicate: true };
    try {
      r = await guard(() => link.sendText(project, to, text, clientId));
    } catch (e) {
      say(`   first reply (${len} chars) failed: ${e instanceof PhotonError ? `${e.kind}:${e.code}` : "error"}`);
      continue;
    }
    if ("guid" in r) {
      replyGuid = r.guid;
      longest = len;
    }
    say(`   first reply (${len} chars): ${"guid" in r ? `guid ${r.guid}` : "duplicate"}`);
    try {
      const again = await guard(() => link.sendText(project, to, text, clientId));
      secondDuplicate = !("guid" in again);
      say(`   second reply, same id: ${"guid" in again ? `guid ${again.guid}` : "duplicate"}`);
    } catch (e) {
      say(`   second reply failed: ${e instanceof PhotonError ? `${e.kind}:${e.code}` : "error"}`);
    }
    break;
  }

  say("5. reopen with since = the sequence before the hi");
  await first.close();
  let replayed = false;
  const seen = hi;
  const second = open(seen.sequence - 1, (m) => {
    if (m.guid === seen.guid) replayed = true;
  });
  await new Promise((r) => setTimeout(r, 10_000));
  await second.close();
  say(`   hi replayed: ${replayed}`);

  say("6. getUser");
  showUser(await guard(() => link.getUser(project, user.userId)));

  say("\nSUMMARY");
  say(`  guid shape: ${seen.guid.replace(/[0-9]/g, "9").replace(/[a-f]/g, "x")}  (e.g. ${seen.guid})`);
  say(`  catch-up replays the hi: ${replayed}`);
  say(`  sendText answers a guid: ${replyGuid !== undefined}`);
  say(`  a reply names the guid it answers: ${events.some((m) => m.fromMe && m.replyTo !== undefined)}`);
  say(`  token expiresIn: ${expiresIn ?? "unknown"} s`);
  say(`  error codes met: ${codes.size ? [...codes].join(", ") : "none"}`);
  say(`  longest reply part through: ${longest} chars`);
  say(`  second send with the same id was a duplicate: ${secondDuplicate ?? "unknown"}`);
  await link.dispose();
  process.exit(0);
}

main().catch(async (e) => {
  note(e);
  console.error(`photon:check failed: ${e instanceof PhotonError ? `${e.kind}:${e.code}` : "unexpected error"}`);
  await link.dispose().catch(() => {});
  process.exit(1);
});
